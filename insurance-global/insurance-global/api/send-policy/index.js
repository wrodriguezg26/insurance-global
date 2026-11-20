"use strict";
/*
 * Insurance Global · Envío del certificado de póliza por correo.
 * Azure Function (Node, sin dependencias externas) que envía el PDF por SMTP
 * con el buzón configurado en las variables de entorno de la Static Web App:
 *   SMTP_USER   buzón completo, p. ej. polizas@t-shits.co           (obligatoria)
 *   SMTP_PASS   contraseña del buzón                                 (obligatoria)
 *   SMTP_HOST   smtpout.secureserver.net (GoDaddy, valor por defecto)
 *   SMTP_PORT   465 (SSL, por defecto) o 587 (STARTTLS)
 *   MAIL_FROM   remitente; por defecto SMTP_USER
 *   MAIL_FROM_NAME  nombre del remitente; por defecto "Insurance Global"
 *   MAIL_BCC    copia oculta opcional para archivo de la compañía
 *   SITE_URL    https://seguros.t-shits.co (para armar el enlace del certificado)
 */
const tls = require("tls");
const net = require("net");
const crypto = require("crypto");

/* ---------- Validación del certificado (mismo sello que usa el sitio) ---------- */
function hash(str){let h1=0xdeadbeef,h2=0x41c6ce57;for(let i=0;i<str.length;i++){const c=str.charCodeAt(i);h1=Math.imul(h1^c,2654435761);h2=Math.imul(h2^c,1597334677)}h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);return(4294967296*(2097151&h2)+(h1>>>0)).toString(16).toUpperCase().padStart(14,"0")}
function readToken(tok){
  try{
    const json=Buffer.from(String(tok).replace(/-/g,"+").replace(/_/g,"/"),"base64").toString("utf8");
    const x=JSON.parse(json);
    if(!x||!x.d||!x.h)return null;
    return hash("IG-CERT|"+JSON.stringify(x.d))===x.h?x.d:null;
  }catch(e){return null}
}

/* ---------- Límite de envíos por IP (memoria de la instancia) ---------- */
const hits=new Map();
function limited(ip){
  const now=Date.now(),win=10*60*1000,max=8;
  const arr=(hits.get(ip)||[]).filter(t=>now-t<win);
  if(arr.length>=max){hits.set(ip,arr);return true}
  arr.push(now);hits.set(ip,arr);return false;
}

/* ---------- Cliente SMTP mínimo (SSL 465 o STARTTLS 587) ---------- */
function smtpSend({host,port,user,pass,from,rcpts,data}){
  return new Promise((resolve,reject)=>{
    let sock,buf="",waiting=null,done=false;
    const timer=setTimeout(()=>fail(new Error("Tiempo de espera agotado con el servidor SMTP")),25000);
    function fail(e){if(done)return;done=true;clearTimeout(timer);try{sock&&sock.destroy()}catch(_){}reject(e)}
    function onData(ch){
      buf+=ch.toString("utf8");
      let m;
      while(waiting&&(m=buf.match(/^(\d{3})([ -])(.*)\r?\n/m))){
        buf=buf.slice(buf.indexOf(m[0])+m[0].length);
        waiting.lines.push(m[3]);
        if(m[2]===" "){const w=waiting;waiting=null;w.resolve({code:+m[1],text:w.lines.join(" ")})}
      }
    }
    const read=()=>new Promise(r=>{waiting={resolve:r,lines:[]};onData(Buffer.alloc(0))});
    async function cmd(line,expect){
      if(line!=null)sock.write(line+"\r\n");
      const r=await read();
      if(!expect.includes(r.code))throw new Error(`SMTP ${r.code}: ${r.text}`.slice(0,300));
      return r;
    }
    function attach(s){sock=s;sock.on("data",onData);sock.on("error",fail)}
    async function run(){
      await cmd(null,[220]);
      const name="insurance-global.azurestaticapps.net";
      await cmd("EHLO "+name,[250]);
      if(port===587){
        await cmd("STARTTLS",[220]);
        const plain=sock;plain.removeAllListeners("data");
        await new Promise((res,rej)=>{const t=tls.connect({socket:plain,servername:host},res);t.on("error",rej);attach(t)});
        await cmd("EHLO "+name,[250]);
      }
      await cmd("AUTH LOGIN",[334]);
      await cmd(Buffer.from(user).toString("base64"),[334]);
      await cmd(Buffer.from(pass).toString("base64"),[235]);
      await cmd(`MAIL FROM:<${from}>`,[250]);
      for(const r of rcpts)await cmd(`RCPT TO:<${r}>`,[250,251]);
      await cmd("DATA",[354]);
      const body=data.replace(/\r?\n/g,"\r\n").replace(/^\./gm,"..");
      const r=await cmd(body+"\r\n.",[250]);
      try{sock.write("QUIT\r\n")}catch(_){}
      done=true;clearTimeout(timer);setTimeout(()=>{try{sock.end()}catch(_){}},200);
      resolve(r.text);
    }
    try{
      if(port===587){attach(net.connect({host,port}));sock.once("connect",()=>run().catch(fail))}
      else{attach(tls.connect({host,port,servername:host}));sock.once("secureConnect",()=>run().catch(fail))}
    }catch(e){fail(e)}
  });
}

/* ---------- Mensaje MIME ---------- */
const b64lines=b=>Buffer.from(b).toString("base64").replace(/(.{76})/g,"$1\r\n");
const encHeader=s=>/^[\x20-\x7e]*$/.test(s)?s:"=?UTF-8?B?"+Buffer.from(s,"utf8").toString("base64")+"?=";
const escHtml=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmtMoney=n=>"$"+Math.round(n).toLocaleString("es-CO");
const fmtDate=s=>{try{return new Date(s+"T12:00:00").toLocaleDateString("es-CO",{year:"numeric",month:"long",day:"numeric"})}catch(e){return s}};
const PRODUCTS={auto:"Autos",hogar:"Hogar",vida:"Vida",salud:"Salud",viaje:"Viajes",mascotas:"Mascotas",pyme:"Empresas"};
const PLANS={esencial:"Esencial",plus:"Plus",total:"Total"};
function buildMessage({fromName,from,to,bcc,d,link,pdf}){
  const first=String(d.name||"").split(" ")[0]||"cliente";
  const prod=PRODUCTS[d.product]||d.product,plan=PLANS[d.plan]||d.plan;
  const subject=`Tu póliza ${d.policy} · Insurance Global`;
  const text=`Hola ${first}:\n\nTu póliza de ${prod.toLowerCase()} (plan ${plan}) fue emitida y aprobada por el servidor central de Insurance Global.\n\nNúmero de póliza: ${d.policy}\nNúmero de aprobación: ${d.approval}\nVigencia: ${fmtDate(d.start)} a ${fmtDate(d.end)}\nTotal: ${fmtMoney(d.premium&&d.premium.total||0)}\n\nAdjuntamos tu certificado en PDF. También puedes consultarlo en línea:\n${link}\n\nSi no reconoces esta compra, responde a este correo.\n\nInsurance Global\n(Simulador académico: Insurance Global es una compañía ficticia y este certificado no es un seguro real.)`;
  const html=`<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#14213d">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb;padding:24px 0"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #dde3ec;border-radius:12px;overflow:hidden">
<tr><td style="background:#0e2a47;padding:22px 28px;color:#ffffff"><b style="font-size:20px">Insurance Global</b><br><span style="font-size:12px;color:#c9d6e6">Certificado individual de seguro</span></td></tr>
<tr><td style="padding:26px 28px;font-size:15px;line-height:1.55">
<p>Hola ${escHtml(first)}:</p>
<p>Tu póliza de <b>${escHtml(prod.toLowerCase())}</b> (plan ${escHtml(plan)}) fue emitida y aprobada por nuestro servidor central.</p>
<table cellpadding="6" cellspacing="0" style="font-size:14px;background:#f0f3f8;border-radius:8px;width:100%">
<tr><td style="color:#5b6b82">Número de póliza</td><td><b style="font-family:Consolas,monospace">${escHtml(d.policy)}</b></td></tr>
<tr><td style="color:#5b6b82">Número de aprobación</td><td><b style="font-family:Consolas,monospace">${escHtml(d.approval)}</b></td></tr>
<tr><td style="color:#5b6b82">Vigencia</td><td>${escHtml(fmtDate(d.start))} a ${escHtml(fmtDate(d.end))}</td></tr>
<tr><td style="color:#5b6b82">Total</td><td>${escHtml(fmtMoney(d.premium&&d.premium.total||0))}</td></tr></table>
<p>Adjuntamos tu certificado en PDF. También puedes consultarlo desde cualquier dispositivo:</p>
<p style="text-align:center"><a href="${escHtml(link)}" style="display:inline-block;background:#1f5fbf;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">Ver mi certificado</a></p>
<p style="font-size:13px;color:#5b6b82">Si no reconoces esta compra, responde a este correo.</p></td></tr>
<tr><td style="background:#fbf3e0;color:#6b4e00;font-size:11px;padding:10px 28px">Simulador académico: Insurance Global es una compañía ficticia y este certificado no es un seguro real.</td></tr>
</table></td></tr></table></body></html>`;
  const b1="mix_"+crypto.randomBytes(8).toString("hex"),b2="alt_"+crypto.randomBytes(8).toString("hex");
  const domain=(from.split("@")[1]||"localhost");
  return [
    `From: ${encHeader(fromName)} <${from}>`,
    `To: <${to}>`,
    `Subject: ${encHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${b1}"`,
    ``,
    `--${b1}`,
    `Content-Type: multipart/alternative; boundary="${b2}"`,
    ``,
    `--${b2}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    b64lines(text),
    `--${b2}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    b64lines(html),
    `--${b2}--`,
    `--${b1}`,
    `Content-Type: application/pdf; name="Poliza-${d.policy}.pdf"`,
    `Content-Disposition: attachment; filename="Poliza-${d.policy}.pdf"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    b64lines(pdf),
    `--${b1}--`,
    ``
  ].join("\r\n");
}

/* ---------- Función HTTP ---------- */
module.exports=async function(context,req){
  const json=(status,body)=>{context.res={status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},body}};
  const cfg={host:process.env.SMTP_HOST||"smtpout.secureserver.net",port:Number(process.env.SMTP_PORT||465),user:process.env.SMTP_USER,pass:process.env.SMTP_PASS};
  if(req.method==="GET"){json(200,{ok:true,configured:!!(cfg.user&&cfg.pass)});return}
  if(!cfg.user||!cfg.pass){json(503,{ok:false,error:"El correo no está configurado (faltan SMTP_USER y SMTP_PASS)."});return}
  const ip=String(req.headers["x-forwarded-for"]||req.headers["x-client-ip"]||"anon").split(",")[0].trim();
  if(limited(ip)){json(429,{ok:false,error:"Demasiados envíos seguidos. Intenta en unos minutos."});return}
  const b=req.body||{};
  const d=readToken(b.token);
  if(!d||!d.policy||!d.approval){json(400,{ok:false,error:"Certificado no válido o modificado."});return}
  const to=String(b.to||"").trim();
  if(to.length>120||!/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i.test(to)){json(400,{ok:false,error:"Correo del destinatario no válido."});return}
  let pdf;
  try{pdf=Buffer.from(String(b.pdf||""),"base64")}catch(e){pdf=null}
  if(!pdf||pdf.length<500||pdf.length>500*1024||pdf.slice(0,5).toString()!=="%PDF-"){json(400,{ok:false,error:"El PDF adjunto no es válido."});return}
  const from=process.env.MAIL_FROM||cfg.user;
  const site=(process.env.SITE_URL||"https://seguros.t-shits.co").replace(/\/+$/,"");
  const link=`${site}/#/c/${b.token}`;
  const bcc=(process.env.MAIL_BCC||"").trim();
  const data=buildMessage({fromName:process.env.MAIL_FROM_NAME||"Insurance Global",from,to,bcc,d,link,pdf});
  try{
    const r=await smtpSend({...cfg,from,rcpts:bcc?[to,bcc]:[to],data});
    context.log(`Póliza ${d.policy} enviada a ${to.replace(/^(.).*(@.*)$/,"$1***$2")}`);
    json(200,{ok:true,policy:d.policy,server:String(r).slice(0,120)});
  }catch(e){
    context.log.error?context.log.error("SMTP: "+e.message):context.log("SMTP: "+e.message);
    json(502,{ok:false,error:"No se pudo enviar el correo: "+e.message});
  }
};
module.exports._test={readToken,buildMessage,smtpSend};
