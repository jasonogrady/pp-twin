import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

// ─── Palette ─────────────────────────────────────────────────────────────────
const K = {
  bg:"#090b08", surface:"#0f120d", card:"#141812", border:"#1e2419",
  b2:"#273021", gold:"#d4a849", green:"#5c8c45", blue:"#4d7fa8",
  red:"#b84f40", text:"#d8d3c2", muted:"#52574a", dim:"#181d14", ink:"#0b0d0a",
};

// ─── Demo data (deterministic, PowerPage-like) ────────────────────────────────
function makeDemo() {
  let s = 0xdeadbeef;
  const rng = n => { s = (Math.imul(1664525,s)+1013904223)|0; return Math.abs(s)%n; };
  const pct = p => rng(100) < p;

  const dayMap = {};
  for (let y = 2000; y <= 2024; y++) {
    const base = y<=2007?74 : y<=2012?61 : y<=2016?45 : y<=2020?28 : 13;
    for (let m = 0; m < 12; m++) {
      const rate = (m>=5&&m<=7) ? Math.round(base*.78) : base;
      const dmax = new Date(y,m+1,0).getDate();
      for (let d = 1; d <= dmax; d++) {
        if (pct(rate)) {
          const ds = `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
          dayMap[ds] = rng(4)+1;
        }
      }
    }
  }

  const byDay = Object.entries(dayMap).map(([day,count])=>({day,count}));
  const total = byDay.reduce((a,r)=>a+(+r.count),0);
  const mM={}, yM={};
  byDay.forEach(({day,count})=>{
    const mo=day.slice(0,7), yr=day.slice(0,4);
    mM[mo]=(mM[mo]||0)+(+count);
    yM[yr]=(yM[yr]||0)+(+count);
  });

  return {
    isDemo:true, total, byDay,
    byAuthor:[
      {author:"Jason O'Grady",    count:Math.round(total*.62)},
      {author:"Connie Guglielmo", count:Math.round(total*.17)},
      {author:"Staff Reporter",   count:Math.round(total*.13)},
      {author:"Guest Author",     count:Math.round(total*.08)},
    ],
    byMonth: Object.entries(mM).sort().map(([month,count])=>({month,count})),
    byYear:  Object.entries(yM).sort().map(([year,count])=>({year,count})),
    byCat:[
      {cat:"Apple",       count:Math.round(total*.22)},
      {cat:"Mac",         count:Math.round(total*.16)},
      {cat:"iPhone",      count:Math.round(total*.13)},
      {cat:"MacBook Pro", count:Math.round(total*.10)},
      {cat:"iPad",        count:Math.round(total*.09)},
      {cat:"iOS/iPadOS",  count:Math.round(total*.07)},
      {cat:"Hardware",    count:Math.round(total*.07)},
      {cat:"Software",    count:Math.round(total*.06)},
      {cat:"Retail",      count:Math.round(total*.05)},
      {cat:"Business",    count:Math.round(total*.05)},
    ],
    recent:[
      {title:"Apple announces M3 MacBook Pro with 18-hour battery",      date:"2024-10-30",author:"Jason O'Grady"},
      {title:"iPad mini 7 hands-on: incremental but necessary",          date:"2024-10-25",author:"Staff Reporter"},
      {title:"macOS Sequoia review: AI takes center stage",              date:"2024-09-16",author:"Jason O'Grady"},
      {title:"iPhone 16 Pro camera first impressions",                   date:"2024-09-09",author:"Jason O'Grady"},
      {title:"Apple Vision Pro after 90 days: productivity or novelty?", date:"2024-05-10",author:"Connie Guglielmo"},
      {title:"M4 iPad Pro is the thinnest Apple product ever made",      date:"2024-05-07",author:"Staff Reporter"},
      {title:"Apple Watch Series 10 review: bigger, thinner, smarter",   date:"2024-09-20",author:"Jason O'Grady"},
      {title:"The state of the Mac in 2024",                             date:"2024-04-15",author:"Jason O'Grady"},
    ],
  };
}

// ─── Calendar helpers ─────────────────────────────────────────────────────────
function buildGrid(year, dayMap) {
  const offset = (new Date(year,0,1).getDay()+6)%7;
  const end = new Date(year,11,31);
  const weeks = [];
  const cur = new Date(year,0,1-offset);
  while (cur <= end) {
    if (!weeks.length || weeks[weeks.length-1].length===7) weeks.push([]);
    const mm=String(cur.getMonth()+1).padStart(2,"0"), dd=String(cur.getDate()).padStart(2,"0");
    const ds=`${cur.getFullYear()}-${mm}-${dd}`;
    const inY=cur.getFullYear()===year;
    weeks[weeks.length-1].push({ds,count:inY?(dayMap[ds]??0):null,inY});
    cur.setDate(cur.getDate()+1);
  }
  while (weeks[weeks.length-1].length<7) weeks[weeks.length-1].push({ds:"",count:null,inY:false});
  return weeks;
}

function longestStreak(byDay) {
  if (!byDay.length) return 0;
  const sorted=[...byDay].map(r=>r.day).sort();
  let best=1,cur=1;
  for (let i=1;i<sorted.length;i++) {
    const diff=(new Date(sorted[i])-new Date(sorted[i-1]))/86400000;
    cur=diff===1?cur+1:1; if(cur>best)best=cur;
  }
  return best;
}

// ─── Heatmap ──────────────────────────────────────────────────────────────────
const MONTHS_SHORT=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function Heatmap({byDay,year,onYear}) {
  const dayMap=useMemo(()=>{const m={};byDay.forEach(r=>{m[r.day]=+r.count;});return m;},[byDay]);
  const maxVal=useMemo(()=>Math.max(1,...Object.values(dayMap)),[dayMap]);
  const heat=n=>!n?K.dim:n/maxVal<.25?"#3b2a08":n/maxVal<.5?"#7a560f":n/maxVal<.8?"#b07c18":K.gold;
  const years=useMemo(()=>[...new Set(byDay.map(r=>r.day.slice(0,4)).filter(Boolean))].sort(),[byDay]);
  const weeks=useMemo(()=>buildGrid(year,dayMap),[year,dayMap]);
  const [tip,setTip]=useState(null);

  const mpos={};
  weeks.forEach((wk,wi)=>wk.forEach(d=>{if(!d.inY||!d.ds)return;const m=+d.ds.slice(5,7)-1;if(!(m in mpos))mpos[m]=wi;}));

  const CS=12,GS=3,ST=CS+GS,ML=22,MT=18;
  return (
    <div>
      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:10}}>
        {years.map(y=>(
          <button key={y} onClick={()=>onYear(+y)} style={{
            padding:"1px 7px",fontSize:11,cursor:"pointer",borderRadius:3,
            fontFamily:"monospace",border:`1px solid ${+y===year?K.gold:K.b2}`,
            background:+y===year?K.gold:"transparent",color:+y===year?K.ink:K.muted,
            transition:"all .1s",
          }}>{y}</button>
        ))}
      </div>
      <div style={{overflowX:"auto"}}>
        <svg width={weeks.length*ST+ML+6} height={7*ST+MT+4} style={{display:"block",userSelect:"none"}}>
          {Object.entries(mpos).map(([m,wi])=>(
            <text key={m} x={wi*ST+ML} y={11} fontSize={9} fill={K.muted} fontFamily="monospace">{MONTHS_SHORT[+m]}</text>
          ))}
          {["M","","W","","F","",""].map((d,i)=>d&&(
            <text key={i} x={1} y={i*ST+MT+7} fontSize={8} fill={K.muted} fontFamily="monospace" dominantBaseline="middle">{d}</text>
          ))}
          {weeks.map((wk,wi)=>wk.map((day,di)=>!day.inY?null:(
            <rect key={`${wi}-${di}`} x={wi*ST+ML} y={di*ST+MT} width={CS} height={CS} rx={2}
              fill={heat(day.count)}
              onMouseEnter={e=>setTip({ds:day.ds,count:day.count,x:e.clientX,y:e.clientY})}
              onMouseLeave={()=>setTip(null)}
            />
          )))}
        </svg>
      </div>
      {tip&&(
        <div style={{position:"fixed",left:tip.x+14,top:tip.y-30,zIndex:999,background:K.surface,
          border:`1px solid ${K.b2}`,borderRadius:5,padding:"3px 8px",fontSize:11,
          fontFamily:"monospace",color:K.text,boxShadow:"0 4px 14px #00000090",pointerEvents:"none"}}>
          {tip.ds} · <span style={{color:K.gold}}>{tip.count} post{tip.count!==1?"s":""}</span>
        </div>
      )}
      <div style={{display:"flex",alignItems:"center",gap:4,marginTop:7,fontSize:10,color:K.muted,fontFamily:"monospace"}}>
        <span>none</span>
        {[K.dim,"#3b2a08","#7a560f","#b07c18",K.gold].map((c,i)=>(
          <div key={i} style={{width:11,height:11,background:c,borderRadius:2,border:`1px solid ${K.b2}`}}/>
        ))}
        <span>max</span>
      </div>
    </div>
  );
}

// ─── 12-month grid ────────────────────────────────────────────────────────────
function MonthGrid({byDay,year}) {
  const dayMap=useMemo(()=>{const m={};byDay.forEach(r=>{m[r.day]=+r.count;});return m;},[byDay]);
  const maxVal=useMemo(()=>Math.max(1,...Object.values(dayMap)),[dayMap]);
  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
      {Array.from({length:12},(_,m)=>{
        const dmax=new Date(year,m+1,0).getDate();
        const fdow=(new Date(year,m,1).getDay()+6)%7;
        const cells=[...Array(fdow).fill(null),...Array.from({length:dmax},(_,i)=>i+1)];
        return (
          <div key={m} style={{background:K.surface,border:`1px solid ${K.border}`,borderRadius:7,padding:"9px 8px"}}>
            <div style={{fontSize:9,fontWeight:700,color:K.gold,marginBottom:6,textTransform:"uppercase",letterSpacing:1.5,fontFamily:"monospace"}}>
              {MONTHS_SHORT[m]}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:1}}>
              {["M","T","W","T","F","S","S"].map((d,i)=>(
                <div key={i} style={{fontSize:7,textAlign:"center",color:K.muted,paddingBottom:2,fontFamily:"monospace"}}>{d}</div>
              ))}
              {cells.map((d,i)=>{
                if(!d) return <div key={i}/>;
                const ds=`${year}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                const count=dayMap[ds]??0, t=count/maxVal;
                const bg=count===0?"transparent":t<.3?"#3b2a08":t<.65?"#7a560f":K.gold;
                return (
                  <div key={i} title={count>0?`${ds}: ${count} post${count!==1?"s":""}`:ds}
                    style={{fontSize:8,textAlign:"center",padding:"2px 0",borderRadius:2,background:bg,
                      color:count>0?(t>.65?K.ink:K.text):K.muted,opacity:count===0?.4:1,
                      fontFamily:"monospace"}}>
                    {d}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Recharts tooltip style ───────────────────────────────────────────────────
const TT={contentStyle:{background:K.surface,border:`1px solid ${K.b2}`,borderRadius:6,fontSize:11,fontFamily:"monospace",color:K.text},cursor:{fill:"#ffffff08"}};

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({stats,onLoadFile}) {
  const streak=useMemo(()=>longestStreak(stats.byDay),[stats.byDay]);
  const span=useMemo(()=>{
    const y=stats.byYear;
    return y.length?`${y[0].year}–${y[y.length-1].year}`:"—";
  },[stats.byYear]);

  const SL={margin:"0 0 10px",fontSize:9,fontWeight:700,color:K.muted,textTransform:"uppercase",letterSpacing:2,fontFamily:"monospace"};

  return (
    <div>
      {/* Masthead */}
      <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:18,flexWrap:"wrap",gap:8}}>
        <div>
          <h1 style={{margin:0,fontFamily:"Georgia,serif",fontSize:26,fontWeight:700,letterSpacing:-.5,color:K.text}}>
            O'Grady's PowerPage
          </h1>
          <p style={{margin:"3px 0 0",fontFamily:"monospace",fontSize:11,color:K.muted}}>
            {span} · {(+stats.total).toLocaleString()} published posts · demo dataset
          </p>
        </div>
        <label style={{cursor:"pointer",padding:"6px 14px",border:`1px solid ${K.b2}`,borderRadius:6,fontSize:11,color:K.muted,fontFamily:"monospace"}}>
          📂 Load real .sqlite
          <input type="file" accept=".db,.sqlite,.sqlite3" style={{display:"none"}} onChange={e=>onLoadFile(e.target.files[0])}/>
        </label>
      </div>

      {/* Stat cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12}}>
        {[
          {label:"Published Posts",   val:(+stats.total).toLocaleString(), color:K.gold},
          {label:"Contributors",      val:stats.byAuthor.length,           color:K.green},
          {label:"Categories",        val:stats.byCat.length,              color:K.blue},
          {label:"Longest Streak",    val:`${streak} days`,                color:"#c07850"},
        ].map(({label,val,color})=>(
          <div key={label} style={{background:K.card,border:`1px solid ${K.border}`,borderRadius:10,padding:"15px 18px"}}>
            <div style={{fontSize:34,fontWeight:800,color,fontFamily:"Georgia,serif",letterSpacing:-1,lineHeight:1}}>{val}</div>
            <div style={{fontSize:10,color:K.muted,marginTop:5,fontFamily:"monospace",textTransform:"uppercase",letterSpacing:.5}}>{label}</div>
          </div>
        ))}
      </div>

      {/* Monthly trend — full width */}
      <div style={{background:K.card,border:`1px solid ${K.border}`,borderRadius:10,padding:"16px 18px",marginBottom:10}}>
        <p style={SL}>Posts per Month — {stats.byMonth.length} months of data</p>
        <ResponsiveContainer width="100%" height={150}>
          <AreaChart data={stats.byMonth} margin={{left:-12,right:4}}>
            <defs>
              <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={K.gold} stopOpacity={.35}/>
                <stop offset="95%" stopColor={K.gold} stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={K.border}/>
            <XAxis dataKey="month" tick={{fill:K.muted,fontSize:9}} interval={Math.max(0,Math.floor(stats.byMonth.length/15))}/>
            <YAxis tick={{fill:K.muted,fontSize:9}} width={32}/>
            <Tooltip {...TT}/>
            <Area type="monotone" dataKey="count" stroke={K.gold} strokeWidth={2} fill="url(#ag)" dot={false}/>
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Row 2 */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
        <div style={{background:K.card,border:`1px solid ${K.border}`,borderRadius:10,padding:"16px 18px"}}>
          <p style={SL}>Posts by Year</p>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={stats.byYear} margin={{left:-12,right:4}}>
              <CartesianGrid strokeDasharray="3 3" stroke={K.border}/>
              <XAxis dataKey="year" tick={{fill:K.muted,fontSize:9}} interval={Math.max(0,Math.floor(stats.byYear.length/8)-1)}/>
              <YAxis tick={{fill:K.muted,fontSize:9}} width={32}/>
              <Tooltip {...TT}/>
              <Bar dataKey="count" fill={K.green} radius={[3,3,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{background:K.card,border:`1px solid ${K.border}`,borderRadius:10,padding:"16px 18px"}}>
          <p style={SL}>Posts by Author</p>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={stats.byAuthor} layout="vertical" margin={{left:4,right:4}}>
              <XAxis type="number" tick={{fill:K.muted,fontSize:9}}/>
              <YAxis dataKey="author" type="category" tick={{fill:K.text,fontSize:10}} width={130}/>
              <Tooltip {...TT}/>
              <Bar dataKey="count" fill={K.gold} radius={[0,3,3,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row 3 */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <div style={{background:K.card,border:`1px solid ${K.border}`,borderRadius:10,padding:"16px 18px"}}>
          <p style={SL}>Top Categories</p>
          <ResponsiveContainer width="100%" height={178}>
            <BarChart data={stats.byCat} layout="vertical" margin={{left:4,right:4}}>
              <XAxis type="number" tick={{fill:K.muted,fontSize:9}}/>
              <YAxis dataKey="cat" type="category" tick={{fill:K.text,fontSize:10}} width={90}/>
              <Tooltip {...TT}/>
              <Bar dataKey="count" fill={K.blue} radius={[0,3,3,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{background:K.card,border:`1px solid ${K.border}`,borderRadius:10,padding:"16px 18px"}}>
          <p style={SL}>Recent Posts</p>
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            {stats.recent.map((p,i)=>(
              <div key={i} style={{padding:"5px 8px",borderRadius:5,background:i%2?K.surface:"transparent"}}>
                <div style={{fontSize:12,color:K.text,fontFamily:"Georgia,serif",lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {p.title}
                </div>
                <div style={{fontSize:10,color:K.muted,fontFamily:"monospace",marginTop:1}}>
                  {p.author} · {p.date}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SQL Explorer ─────────────────────────────────────────────────────────────
function Explorer({db,tables,sql,setSql,result,onRun}) {
  const [hov,setHov]=useState(null);
  return (
    <div style={{display:"grid",gridTemplateColumns:"200px 1fr",gap:12,minHeight:"60vh"}}>
      <div style={{background:K.card,border:`1px solid ${K.border}`,borderRadius:10,padding:12,overflowY:"auto"}}>
        <p style={{margin:"0 0 8px",fontSize:9,fontWeight:700,color:K.muted,textTransform:"uppercase",letterSpacing:2,fontFamily:"monospace"}}>
          Tables · {tables.length}
        </p>
        {tables.map(t=>(
          <div key={t} onMouseEnter={()=>setHov(t)} onMouseLeave={()=>setHov(null)}
            onClick={()=>setSql(`SELECT *\nFROM \`${t}\`\nLIMIT 50;`)}
            style={{padding:"5px 8px",borderRadius:4,cursor:"pointer",marginBottom:1,
              background:hov===t?K.surface:"transparent",color:hov===t?K.gold:K.muted,
              fontFamily:"monospace",fontSize:11,transition:"all .1s"}}>
            ⊞ {t}
          </div>
        ))}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        <div style={{background:K.card,border:`1px solid ${K.border}`,borderRadius:10,padding:14}}>
          <textarea value={sql} onChange={e=>setSql(e.target.value)} spellCheck={false}
            onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==="Enter"){e.preventDefault();onRun();}}}
            style={{width:"100%",height:110,padding:12,resize:"vertical",background:K.surface,
              color:"#8dd4a8",border:`1px solid ${K.b2}`,borderRadius:6,
              fontFamily:"monospace",fontSize:13,lineHeight:1.6,outline:"none",boxSizing:"border-box"}}
          />
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8}}>
            <span style={{fontSize:11,color:K.muted,fontFamily:"monospace"}}>⌘↵ to run</span>
            <button onClick={onRun} style={{padding:"6px 20px",background:K.gold,color:K.ink,border:"none",borderRadius:6,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:700,fontSize:13}}>
              ▶ Run
            </button>
          </div>
        </div>
        {result&&(
          <div style={{background:K.card,border:`1px solid ${result.err?K.red:K.border}`,borderRadius:10,overflow:"hidden"}}>
            {result.err?(
              <div style={{padding:14,color:K.red,fontFamily:"monospace",fontSize:12}}>⚠ {result.err}</div>
            ):(
              <>
                <div style={{padding:"6px 14px",background:K.surface,borderBottom:`1px solid ${K.border}`,fontSize:11,color:K.muted,fontFamily:"monospace"}}>
                  {result.rows.length.toLocaleString()} rows · {result.cols.length} cols
                </div>
                <div style={{overflowX:"auto",maxHeight:400}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"monospace",fontSize:12}}>
                    <thead>
                      <tr style={{background:K.surface,position:"sticky",top:0}}>
                        {result.cols.map(c=>(
                          <th key={c} style={{padding:"7px 12px",textAlign:"left",color:K.gold,fontWeight:600,borderBottom:`1px solid ${K.border}`,whiteSpace:"nowrap"}}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row,i)=>(
                        <tr key={i} style={{background:i%2?K.surface:"transparent"}}>
                          {result.cols.map(c=>(
                            <td key={c} style={{padding:"5px 12px",color:K.text,borderBottom:`1px solid ${K.border}`,maxWidth:280,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                              {row[c]==null?<em style={{color:K.muted}}>NULL</em>:String(row[c])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── sql.js loader ────────────────────────────────────────────────────────────
let _sql=null;
const getSQL=()=>{
  if(_sql)return _sql;
  _sql=new Promise((ok,fail)=>{
    const s=document.createElement("script");
    s.src="https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/sql-wasm.js";
    s.onload=()=>window.initSqlJs({locateFile:f=>`https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/${f}`}).then(ok).catch(fail);
    s.onerror=()=>fail(new Error("sql.js CDN load failed"));
    document.head.appendChild(s);
  });
  return _sql;
};

const execDb=(db,sql)=>{
  try{
    const r=db.exec(sql);
    if(!r?.length)return{cols:[],rows:[],err:null};
    const{columns:cols,values}=r[0];
    return{cols,rows:values.map(v=>Object.fromEntries(cols.map((c,i)=>[c,v[i]]))),err:null};
  }catch(e){return{cols:[],rows:[],err:e.message};}
};
const getDbTables=db=>execDb(db,"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").rows.map(r=>r.name);
const isWP=ts=>ts.includes("wp_posts")&&ts.includes("wp_users");
const wpStats=db=>{
  const q=s=>execDb(db,s).rows;
  return{
    total:execDb(db,"SELECT COUNT(*) n FROM wp_posts WHERE post_status='publish' AND post_type='post'").rows[0]?.n??0,
    byAuthor:q(`SELECT u.display_name author,COUNT(*) count FROM wp_posts p JOIN wp_users u ON p.post_author=u.ID WHERE p.post_status='publish' AND p.post_type='post' GROUP BY p.post_author ORDER BY count DESC LIMIT 20`),
    byMonth:q(`SELECT strftime('%Y-%m',post_date) month,COUNT(*) count FROM wp_posts WHERE post_status='publish' AND post_type='post' GROUP BY month ORDER BY month`),
    byYear:q(`SELECT strftime('%Y',post_date) year,COUNT(*) count FROM wp_posts WHERE post_status='publish' AND post_type='post' GROUP BY year ORDER BY year`),
    byCat:q(`SELECT t.name cat,COUNT(*) count FROM wp_posts p JOIN wp_term_relationships tr ON p.ID=tr.object_id JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id=tt.term_taxonomy_id JOIN wp_terms t ON tt.term_id=t.term_id WHERE tt.taxonomy='category' AND p.post_status='publish' AND p.post_type='post' GROUP BY t.term_id ORDER BY count DESC LIMIT 15`),
    recent:q(`SELECT p.post_title title,p.post_date date,u.display_name author FROM wp_posts p JOIN wp_users u ON p.post_author=u.ID WHERE p.post_status='publish' AND p.post_type='post' ORDER BY p.post_date DESC LIMIT 10`),
    byDay:q(`SELECT date(post_date) day,COUNT(*) count FROM wp_posts WHERE post_status='publish' AND post_type='post' GROUP BY day ORDER BY day`),
  };
};

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [stats,  setStats]  = useState(null);
  const [dbInst, setDbInst] = useState(null);
  const [tables2,setTables2]= useState([]);
  const [tab,    setTab]    = useState("dashboard");
  const [sql,    setSql]    = useState("SELECT ID, post_title, post_date, post_status\nFROM wp_posts\nWHERE post_type = 'post'\n  AND post_status = 'publish'\nORDER BY post_date DESC\nLIMIT 25;");
  const [qRes,   setQRes]   = useState(null);
  const [year,   setYear]   = useState(2010);
  const [loading,setLoading]= useState(false);

  // Boot with demo data immediately
  useEffect(()=>{
    document.body.style.cssText="margin:0;padding:0;background:#090b08;";
    const d=makeDemo();
    setStats(d);
  },[]);

  const loadFile=useCallback(async file=>{
    if(!file)return;
    setLoading(true);
    try{
      const SQL=await getSQL();
      const buf=await file.arrayBuffer();
      const database=new SQL.Database(new Uint8Array(buf));
      const ts=getDbTables(database);
      if(isWP(ts)){
        const s=wpStats(database);
        setStats({...s,isDemo:false});
        setTables2(ts);
        setDbInst(database);
        if(s.byYear.length)setYear(+s.byYear[Math.floor(s.byYear.length*.75)].year);
      }else{
        setTables2(ts);
        setDbInst(database);
        setTab("explorer");
      }
    }catch(e){alert("Error: "+e.message);}
    setLoading(false);
  },[]);

  const runQuery=useCallback(()=>{
    if(!dbInst)return;
    setQRes(execDb(dbInst,sql));
  },[dbInst,sql]);

  if(!stats) return <div style={{background:K.bg,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:K.muted,fontFamily:"monospace"}}>Loading…</div>;

  const TABS=[
    {id:"dashboard",label:"Dashboard"},
    {id:"explorer", label:"SQL Explorer"},
    {id:"calendar", label:"Post Calendar"},
  ];

  const yearPosts=stats.byDay.filter(d=>d.day.startsWith(String(year))).reduce((s,r)=>s+(+r.count),0);

  return (
    <div style={{minHeight:"100vh",background:K.bg,color:K.text}}>
      {/* Header */}
      <div style={{background:K.ink,borderBottom:`1px solid ${K.border}`,position:"sticky",top:0,zIndex:50}}>
        <div style={{maxWidth:1480,margin:"0 auto",padding:"0 20px",display:"flex",alignItems:"center",justifyContent:"space-between",height:50}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontFamily:"Georgia,serif",fontWeight:700,fontSize:16,color:K.text}}>
              PowerPage<span style={{color:K.gold}}>.</span>
            </span>
            <span style={{fontFamily:"monospace",fontSize:10,color:K.muted}}>
              {stats.isDemo?"demo · 2000–2024":"live data"}
            </span>
            {loading&&<span style={{fontSize:10,color:K.gold,fontFamily:"monospace"}}>loading…</span>}
          </div>
          <nav style={{display:"flex",gap:2}}>
            {TABS.map(({id,label})=>(
              <button key={id} onClick={()=>setTab(id)} style={{
                padding:"5px 14px",background:tab===id?K.gold:"transparent",
                color:tab===id?K.ink:K.muted,border:"none",borderRadius:5,cursor:"pointer",
                fontFamily:"monospace",fontSize:12,fontWeight:tab===id?"bold":"normal",
                transition:"all .12s",
              }}>{label}</button>
            ))}
          </nav>
          <label style={{cursor:"pointer",padding:"4px 12px",border:`1px solid ${K.b2}`,borderRadius:5,fontSize:11,color:K.muted,fontFamily:"monospace",transition:"all .1s"}}
            onMouseEnter={e=>e.currentTarget.style.borderColor=K.gold}
            onMouseLeave={e=>e.currentTarget.style.borderColor=K.b2}>
            📂 Load .sqlite
            <input type="file" accept=".db,.sqlite,.sqlite3" style={{display:"none"}} onChange={e=>loadFile(e.target.files[0])}/>
          </label>
        </div>
      </div>

      {/* Content */}
      <div style={{maxWidth:1480,margin:"0 auto",padding:"20px 20px 60px"}}>

        {tab==="dashboard"&&(
          <Dashboard stats={stats} onLoadFile={loadFile}/>
        )}

        {tab==="explorer"&&(
          dbInst?(
            <Explorer db={dbInst} tables={tables2} sql={sql} setSql={setSql} result={qRes} onRun={runQuery}/>
          ):(
            <div style={{textAlign:"center",padding:"70px 0",color:K.muted}}>
              <div style={{fontSize:36,marginBottom:12}}>🗄️</div>
              <p style={{fontFamily:"monospace",fontSize:13}}>SQL Explorer requires a real .sqlite file.</p>
              <p style={{fontFamily:"monospace",fontSize:11,marginTop:6,color:K.border}}>
                Drop a file via the 📂 button to unlock live querying.
              </p>
            </div>
          )
        )}

        {tab==="calendar"&&(
          <div>
            <div style={{display:"flex",alignItems:"baseline",gap:12,marginBottom:18,flexWrap:"wrap"}}>
              <h2 style={{margin:0,fontFamily:"Georgia,serif",fontSize:24,fontWeight:700,letterSpacing:-.5}}>
                Publication Calendar
              </h2>
              <span style={{fontFamily:"monospace",fontSize:11,color:K.muted}}>
                hover for daily counts · dark cells = no posts
              </span>
            </div>

            {/* Activity heatmap */}
            <div style={{background:K.card,border:`1px solid ${K.border}`,borderRadius:10,padding:"16px 18px",marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:12,flexWrap:"wrap",gap:6}}>
                <p style={{margin:0,fontSize:9,fontWeight:700,color:K.muted,textTransform:"uppercase",letterSpacing:2,fontFamily:"monospace"}}>
                  Activity Heatmap
                </p>
                <span style={{fontFamily:"monospace",fontSize:11,color:K.gold}}>
                  {yearPosts.toLocaleString()} posts in {year}
                </span>
              </div>
              <Heatmap byDay={stats.byDay} year={year} onYear={setYear}/>
            </div>

            {/* 12-month calendar */}
            <div style={{background:K.card,border:`1px solid ${K.border}`,borderRadius:10,padding:"16px 18px"}}>
              <p style={{margin:"0 0 14px",fontSize:9,fontWeight:700,color:K.muted,textTransform:"uppercase",letterSpacing:2,fontFamily:"monospace"}}>
                Monthly Calendar — {year} &nbsp;
                <span style={{color:K.muted,fontWeight:"normal",textTransform:"none",letterSpacing:0}}>
                  blank = no posts, hover for count
                </span>
              </p>
              <MonthGrid byDay={stats.byDay} year={year}/>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
