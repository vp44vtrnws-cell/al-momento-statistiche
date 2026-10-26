// Netlify Functions — statistiche automatiche senza esporre la chiave.
// Solo le otto partite autorizzate possono generare chiamate API.
const partite = [
  [{nome:'Frosinone', api:'Frosinone'}, {nome:'Torino', api:'Torino'}],
  [{nome:'Lecce', api:'Lecce'}, {nome:'Genoa', api:'Genoa'}],
  [{nome:'Juventus', api:'Juventus'}, {nome:'Napoli', api:'Napoli'}],
  [{nome:'Avellino', api:'Avellino'}, {nome:'Pisa', api:'Pisa'}],
  [{nome:'Empoli', api:'Empoli'}, {nome:'Juve Stabia', api:'Juve Stabia'}],
  [{nome:'Liverpool', api:'Liverpool'}, {nome:'Arsenal', api:'Arsenal'}],
  [{nome:'Paris FC', api:'Paris FC'}, {nome:'Monaco', api:'Monaco'}],
  [{nome:'Francoforte', api:'Eintracht Frankfurt'}, {nome:'Amburgo', api:'Hamburger SV'}],
];

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
const json = (body, status=200, cached=false) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'Cache-Control': cached ? 'public, max-age=1800' : 'no-store',
    ...(cached ? {'Netlify-CDN-Cache-Control':'public, durable, max-age=82800, stale-while-revalidate=3600'} : {}),
    'X-Content-Type-Options':'nosniff'
  }
});
const key = () => process.env.API_FOOTBALL_KEY;

async function api(path, params={}) {
  const url = new URL('https://v3.football.api-sports.io/'+path);
  for (const [k,v] of Object.entries(params)) url.searchParams.set(k,String(v));
  const response = await fetch(url, {headers:{'x-apisports-key':key()}, signal:AbortSignal.timeout(14000)});
  if (!response.ok) throw Error('API-Football non disponibile ('+response.status+').');
  const payload = await response.json();
  if (payload.errors && Object.keys(payload.errors).length) throw Error('API-Football: dati non disponibili con il piano attuale.');
  return payload.response || [];
}
async function getId(team) {
  const result = await api('teams',{search:team.api});
  const exact = result.find(r=>norm(r.team?.name) === norm(team.api));
  // Per evitare dati della squadra sbagliata, non usiamo corrispondenze incerte.
  return exact?.team?.id || null;
}
const finished = f => ['FT','AET','PEN'].includes(f?.fixture?.status?.short) &&
 Number.isFinite(f?.goals?.home) && Number.isFinite(f?.goals?.away);
function formAndStats(rows, teamId, side) {
  const list=rows.filter(finished).slice(0,5);
  if(!list.length) return {forma:'',fatti:'',subiti:'',gol:'',over:'',rendimento:'Dati non disponibili'};
  let goals=0,against=0,gol=0,over=0,form=[],atSide=[];
  for (const f of list) {
    const home=f.teams.home.id===teamId;
    const gf=home?f.goals.home:f.goals.away, ga=home?f.goals.away:f.goals.home;
    goals+=gf;against+=ga;gol+=gf>0&&ga>0?1:0;over+=gf+ga>=3?1:0;
    const result=gf>ga?'V':gf===ga?'P':'S'; form.push(result);
    if((side==='casa'&&home)||(side==='trasferta'&&!home))atSide.push(result);
  }
  const round=x=>Number(x).toFixed(2).replace('.',',');
  return {
    forma:form.join(' '),
    fatti:round(goals/list.length),subiti:round(against/list.length),
    gol:Math.round(gol*100/list.length),over:Math.round(over*100/list.length),
    rendimento:atSide.length?atSide.join(' · ')+' (nelle ultime '+list.length+')':'Nessuna gara nel campione'
  };
}
function h2hSummary(list, idHome, homeName, awayName) {
  const played=list.filter(finished).slice(0,5);
  if(!played.length) return 'Non sono disponibili precedenti recenti.';
  let wins=0,draws=0,losses=0;
  for(const f of played){
    const home=f.teams.home.id===idHome;
    const gf=home?f.goals.home:f.goals.away,ga=home?f.goals.away:f.goals.home;
    if(gf>ga)wins++;else if(gf===ga)draws++;else losses++;
  }
  return 'Negli ultimi '+played.length+' scontri diretti disponibili: '+homeName+' '+wins+' vittorie, pareggi '+draws+', '+awayName+' '+losses+' vittorie.';
}
export default async function handler(req) {
  if(req.method!=='GET') return json({error:'Metodo non consentito'},405);
  const id=new URL(req.url).searchParams.get('partita');
  if(!/^[0-7]$/.test(id||'')) return json({error:'Partita non valida'},400);
  if(!key()) return json({error:'Chiave API_FOOTBALL_KEY mancante su Netlify'},503);
  const [casa,trasferta]=partite[Number(id)];
  try {
    const cid=await getId(casa), tid=await getId(trasferta);
    if(!cid||!tid) return json({error:'Squadra non identificata in API-Football: '+(!cid?casa.nome:trasferta.nome)},404);
    const fCasa=await api('fixtures',{team:cid,last:5});
    const fTra=await api('fixtures',{team:tid,last:5});
    // I precedenti sono opzionali: un'assenza non blocca le statistiche.
    let precedenti='Precedenti non disponibili';
    try{const h2h=await api('fixtures/headtohead',{h2h:cid+'-'+tid,last:5});precedenti=h2hSummary(h2h,cid,casa.nome,trasferta.nome)}catch{}
    return json({
      casaStats:formAndStats(fCasa,cid,'casa'),
      trasfertaStats:formAndStats(fTra,tid,'trasferta'),
      precedenti,aggiornato:new Date().toISOString(),
      fonte:'API-Football',
      analisi:'Statistiche calcolate sulle ultime 5 gare concluse disponibili per ciascuna squadra, in tutte le competizioni coperte dall’API.'
    },200,true);
  }catch(e){return json({error:String(e?.message||'Servizio momentaneamente non disponibile')},502)}
}
