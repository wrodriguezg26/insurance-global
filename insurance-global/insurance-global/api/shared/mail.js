"use strict";
/*
 * Correo (SMTP) para Insurance Global. El destinatario siempre sale de la base de datos,
 * nunca del navegador. Variables: SMTP_USER, SMTP_PASS, SMTP_HOST, SMTP_PORT, MAIL_FROM,
 * MAIL_FROM_NAME, MAIL_BCC, SITE_URL, MAIL_DRYRUN (1 = valida pero no envía).
 */
const tls = require("tls");
const net = require("net");
const crypto = require("crypto");

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


/* ---------- Correo de beneficio ---------- */
const BEN={
 cursos:{n:"Cursos online con certificación",k:"code",use:"Usa este código en la plataforma de cursos aliada para inscribirte sin costo."},
 coworking:{n:"Coworking",k:"reserve"},
 legal:{n:"Asesoría legal",k:"request"},
 medico:{n:"Orientación médica 24/7",k:"request"},
 bienestar:{n:"Bienestar y gimnasio",k:"code",use:"Presenta este código en los establecimientos aliados para recibir el descuento."},
 vehiculo:{n:"Descuentos para tu carro",k:"code",use:"Presenta este código en los talleres y centros de diagnóstico aliados."},
 hogar:{n:"Expertos para tu hogar",k:"code",use:"Menciona este código al pedir la cotización al proveedor aliado."},
 viajero:{n:"Viajero frecuente",k:"code",use:"Presenta este código en las salas y agencias aliadas."},
 mascota:{n:"Club de mascotas",k:"code",use:"Presenta este código en los establecimientos aliados."},
 empresa:{n:"Capacitación para tu equipo",k:"request"}
};
function buildBenefitMessage({fromName,from,to,d,x,link,pdf}){
  const def=BEN[x.key],first=String(d.name||"").split(" ")[0]||"cliente",t=x.detail||{};
  const subject=def.k==="code"?`Tu beneficio ${def.n} está activo · Insurance Global`:def.k==="reserve"?`Reserva de coworking ${x.code} · Insurance Global`:`Recibimos tu solicitud ${x.code} · Insurance Global`;
  const rows=def.k==="code"?[["Beneficio",def.n],["Código",x.code],["Cómo usarlo",def.use]]:def.k==="reserve"?[["Reserva",x.code],["Ciudad",t.ciudad],["Fecha",fmtDate(t.fecha)],["Jornada",t.jornada],["Siguiente paso","Te enviaremos la dirección del espacio antes de la fecha."]]:[["Solicitud",x.code],["Servicio",def.n],["Tema",t.tema],["Contacto por",t.canal],["Tu mensaje",t.nota||"—"],["Siguiente paso","Te contactaremos en máximo 24 horas hábiles."]];
  rows.push(["Póliza",d.policy]);
  const intro=def.k==="code"?`Activaste el beneficio ${def.n} de tu seguro.`:def.k==="reserve"?"Tu reserva de coworking quedó confirmada.":`Recibimos tu solicitud de ${def.n.toLowerCase()}.`;
  const text=`Hola ${first}:\n\n${intro}\n\n${rows.map(r=>r[0]+": "+r[1]).join("\n")}\n\n${pdf?"Adjuntamos el comprobante en PDF.\n\n":""}Consulta tu póliza y tus beneficios aquí:\n${link}\n\nLos beneficios son servicios de aliados y no hacen parte de las coberturas de la póliza.\n\nInsurance Global\n(Simulador académico: Insurance Global es una compañía ficticia.)`;
  const html=`<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#14213d"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb;padding:24px 0"><tr><td align="center"><table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #dde3ec;border-radius:12px;overflow:hidden"><tr><td style="background:#0e2a47;padding:22px 28px;color:#ffffff"><b style="font-size:20px">Insurance Global</b><br><span style="font-size:12px;color:#c9d6e6">Beneficios de tu seguro</span></td></tr><tr><td style="padding:26px 28px;font-size:15px;line-height:1.55"><p>Hola ${escHtml(first)}:</p><p>${escHtml(intro)}</p><table cellpadding="6" cellspacing="0" style="font-size:14px;background:#e2f4f1;border-radius:8px;width:100%">${rows.map(r=>`<tr><td style="color:#3f6f68;vertical-align:top;width:130px">${escHtml(r[0])}</td><td><b>${escHtml(r[1])}</b></td></tr>`).join("")}</table><p style="text-align:center;margin-top:22px"><a href="${escHtml(link)}" style="display:inline-block;background:#1f5fbf;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">Ver mi póliza y beneficios</a></p><p style="font-size:13px;color:#5b6b82">Los beneficios son servicios de aliados y no hacen parte de las coberturas de la póliza.</p></td></tr><tr><td style="background:#fbf3e0;color:#6b4e00;font-size:11px;padding:10px 28px">Simulador académico: Insurance Global es una compañía ficticia; aliados, códigos y reservas son ficticios.</td></tr></table></td></tr></table></body></html>`;
  const b2="alt_"+crypto.randomBytes(8).toString("hex"),b1="mix_"+crypto.randomBytes(8).toString("hex"),domain=(from.split("@")[1]||"localhost");
  const head=[`From: ${encHeader(fromName)} <${from}>`,`To: <${to}>`,`Subject: ${encHeader(subject)}`,`Date: ${new Date().toUTCString()}`,`Message-ID: <${crypto.randomUUID()}@${domain}>`,`MIME-Version: 1.0`];
  const alt=[`Content-Type: multipart/alternative; boundary="${b2}"`,``,`--${b2}`,`Content-Type: text/plain; charset=UTF-8`,`Content-Transfer-Encoding: base64`,``,b64lines(text),`--${b2}`,`Content-Type: text/html; charset=UTF-8`,`Content-Transfer-Encoding: base64`,``,b64lines(html),`--${b2}--`];
  if(!pdf)return [...head,...alt,``].join("\r\n");
  const fname=`Beneficio-${x.code}.pdf`;
  return [...head,`Content-Type: multipart/mixed; boundary="${b1}"`,``,`--${b1}`,...alt,`--${b1}`,`Content-Type: application/pdf; name="${fname}"`,`Content-Disposition: attachment; filename="${fname}"`,`Content-Transfer-Encoding: base64`,``,b64lines(pdf),`--${b1}--`,``].join("\r\n");
}


const FAKE_MAIL=/@(ejemplo|example|test|prueba)\.(com|co|org|net)$/i;
function cfg(){return{host:process.env.SMTP_HOST||"smtpout.secureserver.net",port:Number(process.env.SMTP_PORT||465),user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}}
const siteUrl=()=>(process.env.SITE_URL||"https://seguros.t-shits.co").replace(/\/+$/,"");
/* Envía un correo ya armado. Devuelve {status:"enviado"|"simulado"|"error", note}. */
async function deliver(to,buildFn){
  if(FAKE_MAIL.test(to))return{status:"simulado",note:"Correo de prueba: no se envía de verdad"};
  const c=cfg();const dry=process.env.MAIL_DRYRUN==="1";
  if(!dry&&(!c.user||!c.pass))return{status:"simulado",note:"Correo no configurado (faltan SMTP_USER y SMTP_PASS)"};
  const from=process.env.MAIL_FROM||c.user||"seguros@t-shits.co";
  const data=buildFn({fromName:process.env.MAIL_FROM_NAME||"Insurance Global",from});
  if(dry)return{status:"simulado",note:"Modo de pruebas de seguridad (MAIL_DRYRUN): validado, no enviado"};
  const bcc=(process.env.MAIL_BCC||"").trim();
  try{await smtpSend({...c,from,rcpts:bcc?[to,bcc]:[to],data});return{status:"enviado",note:"Enviado por SMTP"}}
  catch(e){return{status:"error",note:"No se pudo enviar: "+String(e.message).slice(0,200)}}
}
function sendPolicy(to,d,link,pdf){return deliver(to,({fromName,from})=>buildMessage({fromName,from,to,d,link,pdf}))}
function sendBenefit(to,d,x,link,pdf){return deliver(to,({fromName,from})=>buildBenefitMessage({fromName,from,to,d,x,link,pdf}))}
module.exports={sendPolicy,sendBenefit,siteUrl,FAKE_MAIL,BEN};
