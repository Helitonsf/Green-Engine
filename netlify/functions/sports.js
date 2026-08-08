export default async (req) => {
  const token = process.env.SPORTMONKS_API_TOKEN;
  if (!token) return json({ error: "SPORTMONKS_API_TOKEN não configurado no Netlify." }, 500);

  const u = new URL(req.url);
  const action = u.searchParams.get("action");

  try {
    if (action === "analyze") return await analyzeFixture(u.searchParams.get("fixture"), token);

    const date = u.searchParams.get("date");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Data inválida. Use YYYY-MM-DD." }, 400);

    const r = await sm(`/v3/football/fixtures/date/${date}?include=participants;league;state`, token);
    if (!r.ok) return json({ error: "Sportmonks retornou erro na lista de jogos.", status: r.status, details: safeDetails(r.data) }, r.status);

    const data = Array.isArray(r.data?.data) ? r.data.data : [];
    const normalized = data.map(f => {
      const p = Array.isArray(f.participants) ? f.participants : [];
      const h = p.find(x => x.meta?.location === "home");
      const a = p.find(x => x.meta?.location === "away");
      return { id:f.id, name:`${h?.name||"Casa"} × ${a?.name||"Fora"}`, starting_at:f.starting_at, league:f.league?{id:f.league.id,name:f.league.name}:null, state:f.state?{id:f.state.id,name:f.state.name}:null };
    });
    return json({ ok:true, date, count:normalized.length, data:normalized });
  } catch(e) { return json({ error:"Falha no backend.", details:e.message },502); }
};

async function analyzeFixture(id, token) {
  if (!id || !/^\d+$/.test(id)) return json({error:"Fixture inválido."},400);
  const base = await sm(`/v3/football/fixtures/${id}?include=participants;league;state;scores`, token);
  if (!base.ok || !base.data?.data) return json({error:"Não foi possível consultar a ficha desta partida na Sportmonks.", diagnostic:{status:base.status,details:safeDetails(base.data)}},base.status||502);

  const f=base.data.data;
  const p=Array.isArray(f.participants)?f.participants:[];
  const h=p.find(x=>x.meta?.location==="home"), a=p.find(x=>x.meta?.location==="away");
  const sr=await sm(`/v3/football/fixtures/${id}?include=statistics`,token);
  const stats=sr.ok&&Array.isArray(sr.data?.data?.statistics)?sr.data.data.statistics:[];
  const value=(names,loc)=>{const s=stats.find(x=>names.includes(String(x.type?.name||"").toLowerCase())&&(!loc||x.location===loc));return s?.data?.value??s?.data??null};
  const pair=n=>({home:value(n,"home"),away:value(n,"away")});
  const corners=pair(["corner kicks","corners","corner"]), shots=pair(["shots total","total shots","shots"]), sot=pair(["shots on target","on target"]), cards=pair(["yellow cards","yellowcard","yellow cards total"]);
  const scores=Array.isArray(f.scores)?f.scores:[];
  const cur=scores.find(s=>String(s.description||s.type?.description||"").toLowerCase().includes("current"))||scores[0];
  const xgr=await sm(`/v3/football/fixtures/${id}?include=xGFixture`,token);
  let xg=null;
  if(xgr.ok){const arr=Array.isArray(xgr.data?.data?.xGFixture)?xgr.data.data.xGFixture:[];if(arr.length){const hv=arr.find(x=>x.location==="home"),av=arr.find(x=>x.location==="away");xg={home:hv?.data?.value??hv?.value??null,away:av?.data?.value??av?.value??null};}}
  const markets=[];const ct=num(corners.home)+num(corners.away), st=num(shots.home)+num(shots.away), so=num(sot.home)+num(sot.away);
  if(ct>0)markets.push({name:"Escanteios",score:Math.min(95,50+Math.round(ct*1.5)),reason:`Total registrado: ${ct}.`});
  if(st>0)markets.push({name:"Finalizações",score:Math.min(95,45+Math.round(st*1.2)),reason:`Total registrado: ${st}.`});
  if(so>0)markets.push({name:"Finalizações no alvo",score:Math.min(95,45+Math.round(so*3)),reason:`Total registrado: ${so}.`});
  const available=[corners.home,corners.away,shots.home,shots.away,sot.home,sot.away,cards.home,cards.away].filter(v=>typeof v==="number").length;
  return json({ok:true,id,name:f.name||`${h?.name||"Casa"} × ${a?.name||"Fora"}`,starting_at:f.starting_at,league:f.league?.name,state:f.state?.name,metrics:{homeGoals:cur?.score?.goals??null,awayGoals:cur?.score?.goals??null,corners,shots,shotsOnTarget:sot,cards,xg,statisticsAvailable:stats.length>0},greenScore:available?Math.min(95,40+available*7):null,markets,diagnostic:{fixtureRequestOk:true,statisticsRequestOk:sr.ok,statisticsCount:stats.length,xgRequestOk:xgr.ok,xgAvailable:!!xg}});
}

async function sm(path,token){const url=`https://api.sportmonks.com${path}${path.includes("?")?"&":"?"}api_token=${encodeURIComponent(token)}`;const r=await fetch(url,{headers:{Accept:"application/json"}});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={raw:text}}return{ok:r.ok,status:r.status,data};}
function safeDetails(d){return d?{message:d.message,errors:d.errors,raw:d.raw}:null}
function num(v){return typeof v==="number"?v:0}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}})}
