"use strict";
/* Catálogo compartido (productos, tarifas, beneficios). Copia del catálogo del sitio: si cambias tarifas o beneficios, cámbialos en ambos lados. */
const money=n=>"$"+Math.round(n).toLocaleString("es-CO");
const OFFICES=[
 {id:"BOG",city:"Bogotá",name:"Sede principal Chicó",addr:"Calle 93 # 11-26",hours:"Lun–vie 8:00–18:00 · sáb 9:00–13:00",central:true,sellers:["Camila Rojas","Julián Herrera"]},
 {id:"MED",city:"Medellín",name:"Oficina El Poblado",addr:"Carrera 43A # 7-50",hours:"Lun–vie 8:00–18:00 · sáb 9:00–13:00",sellers:["Daniela Restrepo","Santiago Mejía"]},
 {id:"CAL",city:"Cali",name:"Oficina Granada",addr:"Avenida 9N # 15-40",hours:"Lun–vie 8:00–17:30",sellers:["Valentina Cruz","Felipe Ocampo"]},
 {id:"BAQ",city:"Barranquilla",name:"Oficina Alto Prado",addr:"Carrera 53 # 82-86",hours:"Lun–vie 8:00–17:30",sellers:["María José Díaz","Andrés Barrios"]},
 {id:"BGA",city:"Bucaramanga",name:"Oficina Cabecera",addr:"Calle 52 # 35-10",hours:"Lun–vie 8:00–17:30",sellers:["Laura Ardila","Sergio Pinzón"]}
];
const CITIES=["Bogotá","Medellín","Cali","Barranquilla","Bucaramanga","Cartagena","Pereira","Otra ciudad"];
const PLANS=[["esencial","Esencial",.75],["plus","Plus",1],["total","Total",1.4]];
const planName=k=>(PLANS.find(p=>p[0]===k)||[])[1]||k;
const P={
 auto:{name:"Autos",code:"AUT",ic:"auto",tag:"Todo riesgo para tu carro, con grúa y asistencia 24/7.",iva:true,
  fields:[{id:"valor",label:"Valor comercial del vehículo (guía Fasecolda)",type:"money",def:85000000,min:10000000,max:600000000},
          {id:"modelo",label:"Año del modelo",type:"number",def:2021,min:2000,max:2027},
          {id:"ciudad",label:"Ciudad de circulación",type:"select",opts:CITIES,def:"Bogotá"},
          {id:"uso",label:"Uso del vehículo",type:"select",opts:["Particular","Trabajo o plataformas"],def:"Particular"}],
  calc:v=>{const age=Math.max(0,2026-v.modelo);const cf={"Bogotá":1.1,"Medellín":1.05,"Cali":1.08,"Cartagena":1.04}[v.ciudad]||1;return v.valor*.026*(1+age*.012)*cf*(v.uso==="Particular"?1:1.3)},
  review:v=>v.valor>300000000?"Vehículo de alto valor: requiere inspección y suscripción manual.":null,
  extra:[{id:"placa",label:"Placa",ph:"ABC123",re:/^[A-Z]{3}\d{2}[A-Z0-9]$/i,msg:"La placa debe tener 3 letras y 3 caracteres (ej. ABC123)."},{id:"marca",label:"Marca y línea",ph:"Ej. Mazda 3 Touring"}],
  desc:v=>`Vehículo modelo ${v.modelo}, valor asegurado ${money(v.valor)}, ${v.ciudad}, uso ${v.uso.toLowerCase()}`,
  cov:[["Responsabilidad civil extracontractual","$1.000 M","$2.000 M","$4.000 M"],["Pérdida total por daños o hurto","✓","✓","✓"],["Pérdida parcial por daños","—","✓","✓"],["Pérdida parcial por hurto","—","✓","✓"],["Grúa y asistencia en carretera 24/7","✓","✓","✓"],["Vehículo de reemplazo","—","10 días","30 días"],["Conductor elegido","—","3 al año","Ilimitado"]]},
 hogar:{name:"Hogar",code:"HOG",ic:"hogar",tag:"Tu casa y lo que hay en ella, protegidos contra incendio, agua y hurto.",iva:true,
  fields:[{id:"inmueble",label:"Valor de reconstrucción del inmueble",type:"money",def:300000000,min:0,max:5000000000},
          {id:"contenido",label:"Valor de tus contenidos (muebles, equipos)",type:"money",def:40000000,min:0,max:800000000},
          {id:"tipo",label:"Tipo de vivienda",type:"select",opts:["Apartamento","Casa"],def:"Apartamento"},
          {id:"ciudad",label:"Ciudad",type:"select",opts:CITIES,def:"Bogotá"}],
  calc:v=>(v.inmueble*.0021+v.contenido*.009)*(v.tipo==="Casa"?1.15:1),
  review:v=>v.inmueble>2000000000?"Inmueble de alto valor: requiere inspección del riesgo.":(v.inmueble+v.contenido===0?"No hay valores asegurados.":null),
  extra:[{id:"dir_riesgo",label:"Dirección del inmueble asegurado",ph:"Calle 100 # 15-20, apto 501"}],
  desc:v=>`${v.tipo} en ${v.ciudad}; inmueble ${money(v.inmueble)}, contenidos ${money(v.contenido)}`,
  cov:[["Incendio, terremoto y eventos de la naturaleza","✓","✓","✓"],["Daños por agua","—","✓","✓"],["Hurto de contenidos","—","✓","✓"],["Responsabilidad civil familiar","$50 M","$150 M","$300 M"],["Asistencia hogar (plomería, cerrajería, electricidad)","2 al año","4 al año","Ilimitada"],["Equipos electrónicos fuera de casa","—","—","✓"]]},
 vida:{name:"Vida",code:"VID",ic:"vida",tag:"Respaldo económico para tu familia cuando más lo necesita.",iva:false,
  fields:[{id:"edad",label:"Tu edad",type:"number",def:35,min:18,max:75},
          {id:"suma",label:"Suma asegurada",type:"money",def:200000000,min:20000000,max:2000000000},
          {id:"fuma",label:"¿Fumas?",type:"select",opts:["No","Sí"],def:"No"}],
  calc:v=>v.suma*(.55+(v.edad-18)*.085)/1000*(v.fuma==="Sí"?1.6:1),
  review:v=>(v.suma>800000000||v.edad>65)?"Suma o edad fuera del rango automático: requiere declaración médica y suscripción manual.":null,
  extra:"beneficiarios",
  desc:v=>`Suma asegurada ${money(v.suma)}; asegurado de ${v.edad} años${v.fuma==="Sí"?", fumador":""}`,
  cov:[["Muerte por cualquier causa","✓","✓","✓"],["Incapacidad total y permanente","—","✓","✓"],["Enfermedades graves (anticipo)","—","30%","50%"],["Auxilio funerario","$5 M","$10 M","$15 M"],["Renta diaria por hospitalización","—","—","$150.000"]]},
 salud:{name:"Salud",code:"SAL",ic:"salud",tag:"Especialistas sin autorizaciones y red de clínicas en todo el país.",iva:false,
  fields:[{id:"edad",label:"Edad del titular",type:"number",def:32,min:0,max:70},
          {id:"personas",label:"Personas a asegurar (incluido el titular)",type:"number",def:1,min:1,max:6},
          {id:"ciudad",label:"Ciudad",type:"select",opts:CITIES,def:"Bogotá"}],
  calc:v=>1450000*(1+Math.max(0,v.edad-18)*.028)*(1+(v.personas-1)*.85),
  review:v=>v.edad>60?"Titular mayor de 60 años: requiere valoración médica.":null,
  extra:[{id:"eps",label:"EPS a la que estás afiliado",ph:"Nombre de tu EPS"}],
  desc:v=>`${v.personas} persona(s), titular de ${v.edad} años, ${v.ciudad}`,
  cov:[["Consulta con especialista sin autorización","✓","✓","✓"],["Hospitalización y cirugía","Red básica","Red amplia","Red premium"],["Medicamentos ambulatorios","—","70%","90%"],["Urgencias en el exterior","—","USD 20.000","USD 100.000"],["Copago por consulta","$35.000","$20.000","$0"]]},
 viaje:{name:"Viajes",code:"VIA",ic:"viaje",tag:"Asistencia médica y de equipaje en cualquier destino.",iva:true,monthly:false,
  fields:[{id:"destino",label:"Destino",type:"select",opts:["Nacional","Latinoamérica","Estados Unidos y Canadá","Europa (Schengen)","Resto del mundo"],def:"Europa (Schengen)"},
          {id:"dias",label:"Días de viaje",type:"number",def:15,min:1,max:180},
          {id:"viajeros",label:"Viajeros",type:"number",def:2,min:1,max:8},
          {id:"edad",label:"Edad del viajero mayor",type:"number",def:40,min:0,max:85}],
  calc:v=>v.dias*({"Nacional":6000,"Latinoamérica":14000,"Estados Unidos y Canadá":26000,"Europa (Schengen)":22000,"Resto del mundo":28000}[v.destino])*v.viajeros*(v.edad>70?1.8:1),
  review:v=>v.edad>80?"Viajero mayor de 80 años: requiere valoración médica.":null,
  extra:[{id:"salida",label:"Fecha de salida",type:"date"}],
  desc:v=>`${v.destino}, ${v.dias} días, ${v.viajeros} viajero(s)`,
  cov:[["Gastos médicos por enfermedad o accidente","USD 30.000","USD 60.000","USD 150.000"],["Cumple requisito Schengen (€30.000)","✓","✓","✓"],["Pérdida o demora de equipaje","—","USD 1.200","USD 3.000"],["Cancelación del viaje","—","USD 1.000","USD 5.000"],["Repatriación sanitaria","✓","✓","✓"]]},
 mascotas:{name:"Mascotas",code:"MAS",ic:"mascotas",tag:"Veterinario, urgencias y responsabilidad civil para tu perro o gato.",iva:true,
  fields:[{id:"tipo",label:"Mascota",type:"select",opts:["Perro","Gato"],def:"Perro"},
          {id:"edad",label:"Edad (años)",type:"number",def:3,min:0,max:12}],
  calc:v=>(v.tipo==="Perro"?420000:330000)*(1+v.edad*.09),
  review:()=>null,
  extra:[{id:"mascota",label:"Nombre de la mascota",ph:"Luna"},{id:"raza",label:"Raza",ph:"Criolla"}],
  desc:v=>`${v.tipo} de ${v.edad} año(s)`,
  cov:[["Consultas veterinarias","2 al año","6 al año","Ilimitadas"],["Urgencias y cirugía","$2 M","$5 M","$10 M"],["Responsabilidad civil por daños a terceros","$5 M","$15 M","$30 M"],["Vacunación anual","—","✓","✓"],["Exequias","—","✓","✓"]]},
 pyme:{name:"Empresas",code:"EMP",ic:"pyme",tag:"Protección para el negocio, sus activos y su responsabilidad.",iva:true,
  fields:[{id:"activos",label:"Valor de activos (local, inventario, equipos)",type:"money",def:250000000,min:20000000,max:10000000000},
          {id:"actividad",label:"Actividad",type:"select",opts:["Comercio","Oficina y servicios","Restaurante","Manufactura"],def:"Comercio"},
          {id:"empleados",label:"Número de empleados",type:"number",def:8,min:1,max:500}],
  calc:v=>v.activos*.0034*({"Comercio":1,"Oficina y servicios":.8,"Restaurante":1.3,"Manufactura":1.5}[v.actividad])+v.empleados*45000,
  review:v=>v.activos>3000000000?"Activos superiores a $3.000 M: requiere inspección del riesgo.":null,
  extra:[{id:"razon",label:"Razón social",ph:"Mi Empresa S.A.S."},{id:"nit",label:"NIT",ph:"900123456-7",re:/^\d{9}-?\d$/,msg:"El NIT debe tener 9 dígitos y el dígito de verificación."}],
  desc:v=>`${v.actividad}, activos ${money(v.activos)}, ${v.empleados} empleados`,
  cov:[["Incendio y terremoto de local e inventario","✓","✓","✓"],["Hurto y equipos electrónicos","—","✓","✓"],["Responsabilidad civil","$100 M","$300 M","$1.000 M"],["Lucro cesante","—","3 meses","6 meses"],["Manejo y fidelidad de empleados","—","—","✓"]]}
};
const defaults=pid=>Object.fromEntries(P[pid].fields.map(f=>[f.id,f.def]));
function validParams(p,v){for(const f of p.fields){if(f.type==="select")continue;const n=v[f.id];if(!Number.isFinite(n))return `Completa “${f.label}”.`;if(n<f.min||n>f.max)return `“${f.label}” debe estar entre ${f.type==="money"?money(f.min):f.min} y ${f.type==="money"?money(f.max):f.max}.`}return ""}
function price(pid,v,plan){const p=P[pid];const k=(PLANS.find(x=>x[0]===plan)||PLANS[1])[2];let neta=Math.round(Math.max(120000,p.calc(v))*k/100)*100;const iva=p.iva?Math.round(neta*.19):0;const total=neta+iva;return{neta,iva,total,mensual:Math.round(total*1.05/12)}}
const BENEFITS={
 cursos:{ic:"doc",code:"CUR",name:"Cursos online con certificación",desc:"Accede gratis a cursos virtuales de una plataforma aliada y obtén un certificado al terminar cada uno.",action:"Activar acceso",kind:"code",use:"Usa este código en la plataforma de cursos aliada para inscribirte sin costo."},
 coworking:{ic:"office",code:"COW",name:"Coworking",desc:"Reserva un puesto de trabajo en espacios de coworking aliados en las principales ciudades.",action:"Reservar",kind:"reserve"},
 legal:{ic:"shield",code:"LEG",name:"Asesoría legal",desc:"Sabemos que los temas legales no son tus favoritos. Recibe orientación legal gratuita por teléfono o videollamada.",action:"Solicitar asesoría",kind:"request",topics:["Tránsito y comparendos","Arrendamiento y vivienda","Familia","Laboral","Consumidor","Otro"]},
 medico:{ic:"salud",code:"MED",name:"Orientación médica 24/7",desc:"Habla con un médico por teléfono o videollamada a cualquier hora, sin costo adicional.",action:"Solicitar llamada",kind:"request",topics:["Síntomas o malestar","Dudas sobre medicamentos","Resultados de exámenes","Otro"]},
 bienestar:{ic:"vida",code:"BIE",name:"Bienestar y gimnasio",desc:"Descuentos en gimnasios, nutrición y acompañamiento emocional con la red aliada.",action:"Activar descuento",kind:"code",use:"Presenta este código en los establecimientos aliados para recibir el descuento."},
 vehiculo:{ic:"auto",code:"VEH",name:"Descuentos para tu carro",desc:"Descuentos en revisión técnico-mecánica, lavado y talleres aliados.",action:"Activar descuento",kind:"code",use:"Presenta este código en los talleres y centros de diagnóstico aliados."},
 hogar:{ic:"hogar",code:"HOG",name:"Expertos para tu hogar",desc:"Tarifas preferenciales en pintura, remodelación y mantenimiento con proveedores verificados.",action:"Activar descuento",kind:"code",use:"Menciona este código al pedir la cotización al proveedor aliado."},
 viajero:{ic:"viaje",code:"VIA",name:"Viajero frecuente",desc:"Descuentos en salas VIP de aeropuertos y en alquiler de carros durante tu viaje.",action:"Activar descuento",kind:"code",use:"Presenta este código en las salas y agencias aliadas."},
 mascota:{ic:"mascotas",code:"MAS",name:"Club de mascotas",desc:"Descuentos en tiendas, peluquería y guarderías aliadas para tu perro o gato.",action:"Activar descuento",kind:"code",use:"Presenta este código en los establecimientos aliados."},
 empresa:{ic:"users",code:"EMP",name:"Capacitación para tu equipo",desc:"Talleres virtuales de seguridad en el trabajo y primeros auxilios para tus empleados.",action:"Inscribir equipo",kind:"request",topics:["Seguridad y salud en el trabajo","Primeros auxilios","Prevención de incendios","Otro"]}
};
const PRODUCT_BENEFITS={auto:["legal","vehiculo","cursos"],hogar:["legal","hogar","coworking"],vida:["medico","legal","cursos"],salud:["medico","bienestar","cursos"],viaje:["viajero","medico","cursos"],mascotas:["mascota","legal","cursos"],pyme:["coworking","legal","empresa","cursos"]};
const benefitsOf=pid=>PRODUCT_BENEFITS[pid]||[];
module.exports={money,OFFICES,CITIES,PLANS,planName,P,defaults,validParams,price,BENEFITS,PRODUCT_BENEFITS,benefitsOf};
