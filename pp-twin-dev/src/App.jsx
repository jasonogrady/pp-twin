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

// ─── Editor dashboard helpers ─────────────────────────────────────────────────
function deriveEditorMetrics(stats) {
  const byDay = stats.byDay || [];
  const dayMap = new Map(byDay.map(r => [r.day, +r.count]));
  const sorted = [...byDay].sort((a,b) => a.day < b.day ? -1 : 1);
  const yrNow = new Date().getFullYear();

  // Avg posts/week this year (only weeks that have passed)
  const thisYearDays = sorted.filter(r => r.day.startsWith(String(yrNow)));
  const thisYearPosts = thisYearDays.reduce((a,r) => a + (+r.count), 0);
  const today = new Date();
  const startOfYear = new Date(yrNow, 0, 1);
  const weeksElapsed = Math.max(1, Math.ceil((today - startOfYear) / (7 * 86400000)));
  const avgPerWeekThisYear = thisYearPosts / weeksElapsed;

  // Posts in last 30 days
  const cutoff30 = new Date(today.getTime() - 30 * 86400000).toISOString().slice(0,10);
  const last30 = sorted.filter(r => r.day >= cutoff30).reduce((a,r) => a + (+r.count), 0);

  // Last published date
  const lastDay = sorted.length ? sorted[sorted.length - 1].day : null;
  const daysSinceLast = lastDay ? Math.floor((today - new Date(lastDay)) / 86400000) : null;

  // Top weeks (group byDay into ISO-ish weeks)
  const weekMap = {};
  for (const r of sorted) {
    const d = new Date(r.day + "T00:00:00");
    const wkStart = new Date(d);
    wkStart.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
    const wkKey = wkStart.toISOString().slice(0,10);
    weekMap[wkKey] = (weekMap[wkKey] || 0) + (+r.count);
  }
  const topWeeks = Object.entries(weekMap)
    .map(([week, count]) => ({ week, count }))
    .sort((a,b) => b.count - a.count)
    .slice(0, 5);

  // Longest streak (consecutive *publishing* days, weekends counted)
  let bestStreak = 0, curStreak = 0;
  if (sorted.length) {
    let prev = null;
    for (const r of sorted) {
      const d = new Date(r.day + "T00:00:00");
      if (prev && (d - prev) === 86400000) curStreak++;
      else curStreak = 1;
      if (curStreak > bestStreak) bestStreak = curStreak;
      prev = d;
    }
  }

  // Current streak (back from last publication day)
  let liveStreak = 0;
  if (lastDay) {
    let cursor = new Date(lastDay + "T00:00:00");
    while (dayMap.has(cursor.toISOString().slice(0,10))) {
      liveStreak++;
      cursor.setDate(cursor.getDate() - 1);
    }
  }

  // Last 52 weeks sparkline
  const last52 = [];
  const cur = new Date(today);
  cur.setDate(cur.getDate() - ((cur.getDay() + 6) % 7)); // Monday of this week
  for (let i = 51; i >= 0; i--) {
    const wkStart = new Date(cur);
    wkStart.setDate(wkStart.getDate() - i * 7);
    const wkKey = wkStart.toISOString().slice(0,10);
    last52.push({ week: wkKey.slice(5), count: weekMap[wkKey] || 0 });
  }

  // YoY delta
  const ytdDelta = stats.lastYearCount > 0
    ? Math.round(100 * ((stats.thisYearCount || 0) - stats.lastYearCount) / stats.lastYearCount)
    : null;

  return {
    avgPerWeekThisYear: Math.round(avgPerWeekThisYear * 10) / 10,
    last30,
    lastDay,
    daysSinceLast,
    topWeeks,
    bestStreak,
    liveStreak,
    last52,
    ytdDelta,
    weeksElapsed,
  };
}

function StatCard({ label, value, sub, color = "#d8d3c2", accent }) {
  return (
    <div style={{ background: K.card, border: `1px solid ${accent || K.border}`, borderRadius: 10, padding: "12px 14px", minHeight: 78 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: K.muted, textTransform: "uppercase", letterSpacing: 1.6, fontFamily: "monospace", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: "Georgia,serif", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: K.muted, fontFamily: "monospace", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function EditorDashboard({ stats }) {
  const m = useMemo(() => deriveEditorMetrics(stats), [stats]);
  const yrNow = new Date().getFullYear();
  const fmt = n => n == null ? "—" : (+n).toLocaleString();
  const deltaColor = d => d == null ? K.muted : d > 0 ? K.green : d < -10 ? K.red : K.gold;

  return (
    <div style={{ marginBottom: 22 }}>
      {/* Volume row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 10 }}>
        <StatCard label="Total Posts" value={fmt(stats.total)} sub={`since ${stats.byYear[0]?.year || "—"}`} color={K.gold} />
        <StatCard label={`Posts ${yrNow}`}
          value={fmt(stats.thisYearCount)}
          sub={m.ytdDelta == null ? `vs ${yrNow-1}: —` : `${m.ytdDelta > 0 ? "+" : ""}${m.ytdDelta}% vs ${yrNow-1}`}
          color={deltaColor(m.ytdDelta)} />
        <StatCard label="Avg / Week" value={m.avgPerWeekThisYear} sub={`${yrNow} (${m.weeksElapsed} wks elapsed)`} />
        <StatCard label="Last 30 Days" value={fmt(m.last30)} sub="all posts" />
        <StatCard label="Last Published"
          value={m.daysSinceLast == null ? "—" : m.daysSinceLast === 0 ? "today" : `${m.daysSinceLast}d ago`}
          sub={m.lastDay || ""}
          color={m.daysSinceLast > 7 ? K.red : m.daysSinceLast > 2 ? K.gold : K.green} />
        <StatCard label="Authors Active" value={fmt(stats.authorsActiveThisYear)} sub={`distinct in ${yrNow}`} />
        <StatCard label="Longest Streak" value={fmt(m.bestStreak)} sub="consecutive days, all time" />
        <StatCard label="Current Streak" value={fmt(m.liveStreak)} sub="from last post backward" />
      </div>

      {/* Engagement row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 10 }}>
        <StatCard label="Total Comments" value={fmt(stats.totalComments)} sub="approved · all-time" color={K.blue} />
        <StatCard label="Posts w/ Comments" value={fmt(stats.postsWithComments)}
          sub={stats.total ? `${Math.round(100 * stats.postsWithComments / stats.total)}% of all posts` : ""} />
        <StatCard label="Posts ≥10 Comments" value={fmt(stats.postsWith10Plus)} sub="discussion threshold" />
        <StatCard label={`Top Author ${yrNow}`}
          value={stats.topAuthorThisYear?.author || "—"}
          sub={stats.topAuthorThisYear ? `${stats.topAuthorThisYear.count} posts` : ""}
          color={K.text} />
        <StatCard label={`Top Category ${yrNow}`}
          value={stats.topCatThisYear?.cat || "—"}
          sub={stats.topCatThisYear ? `${stats.topCatThisYear.count} posts` : ""}
          color={K.text} />
        <StatCard label={`Top Tag ${yrNow}`}
          value={stats.topTagThisYear?.tag || "—"}
          sub={stats.topTagThisYear ? `${stats.topTagThisYear.count} posts` : ""}
          color={K.text} />
        <StatCard label="Avg Post Length" value={stats.avgPostLen ? `${Math.round(stats.avgPostLen/5)}w` : "—"} sub={`${fmt(stats.avgPostLen)} chars`} />
        <StatCard label="Distinct Tags Used" value={fmt(stats.byTag?.length || 0)} sub="top 20 surfaced" />
      </div>

      {/* Two-column: weekly sparkline + top weeks + most discussed */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)", gap: 10, marginBottom: 10 }}>
        {/* Sparkline */}
        <div style={{ background: K.card, border: `1px solid ${K.border}`, borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: K.muted, textTransform: "uppercase", letterSpacing: 1.6, fontFamily: "monospace" }}>Weekly Cadence · Last 52 Weeks</span>
            <span style={{ fontFamily: "monospace", fontSize: 10, color: K.gold }}>peak: {Math.max(...m.last52.map(w => w.count))}/wk</span>
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={m.last52} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="weekGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={K.gold} stopOpacity={0.6} />
                  <stop offset="100%" stopColor={K.gold} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={K.dim} vertical={false} />
              <XAxis dataKey="week" stroke={K.muted} fontSize={9} tickLine={false} interval={6} />
              <YAxis stroke={K.muted} fontSize={9} tickLine={false} width={28} />
              <Tooltip contentStyle={{ background: K.ink, border: `1px solid ${K.border}`, fontFamily: "monospace", fontSize: 11 }} labelStyle={{ color: K.text }} />
              <Area type="monotone" dataKey="count" stroke={K.gold} strokeWidth={1.5} fill="url(#weekGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Top weeks */}
        <div style={{ background: K.card, border: `1px solid ${K.border}`, borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: K.muted, textTransform: "uppercase", letterSpacing: 1.6, fontFamily: "monospace", marginBottom: 10 }}>Top 5 Weeks · All Time</div>
          <table style={{ width: "100%", fontFamily: "monospace", fontSize: 12, borderCollapse: "collapse" }}>
            <tbody>
              {m.topWeeks.map(w => (
                <tr key={w.week} style={{ borderBottom: `1px solid ${K.dim}` }}>
                  <td style={{ padding: "5px 0", color: K.text }}>week of {w.week}</td>
                  <td style={{ padding: "5px 0", textAlign: "right", color: K.gold }}>{w.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Most discussed posts */}
      {stats.topComments?.length > 0 && (
        <div style={{ background: K.card, border: `1px solid ${K.border}`, borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: K.muted, textTransform: "uppercase", letterSpacing: 1.6, fontFamily: "monospace", marginBottom: 10 }}>Most-Discussed Posts · All Time</div>
          {stats.topComments.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: i < stats.topComments.length - 1 ? `1px solid ${K.dim}` : "none", fontFamily: "monospace", fontSize: 12 }}>
              <span style={{ color: K.gold, minWidth: 32, textAlign: "right" }}>{p.comments}</span>
              <span style={{ color: K.muted, minWidth: 80 }}>{(p.date || "").slice(0,10)}</span>
              <span style={{ color: K.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Gap analysis ─────────────────────────────────────────────────────────────
function computeGapStats(byDay, byYear) {
  const postsByDay = new Map(byDay.map(r => [r.day, +r.count]));
  const byYearMap = Object.fromEntries(byYear.map(r => [r.year, +r.count]));
  const yearMap = {};
  const weekdays = [];
  const start = new Date(1995, 11, 1);
  const today = new Date();
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const yr = ds.slice(0,4);
    const posts = postsByDay.get(ds) || 0;
    weekdays.push({ day: ds, posts });
    if (!yearMap[yr]) yearMap[yr] = { year: yr, weekdays: 0, gaps: 0 };
    yearMap[yr].weekdays++;
    if (posts === 0) yearMap[yr].gaps++;
  }
  const ranges = [];
  let cur = null;
  for (const w of weekdays) {
    if (w.posts === 0) {
      if (!cur) cur = { start: w.day, end: w.day, weekdays: 1 };
      else { cur.end = w.day; cur.weekdays++; }
    } else if (cur) { ranges.push(cur); cur = null; }
  }
  if (cur) ranges.push(cur);
  ranges.sort((a,b) => b.weekdays - a.weekdays);
  const summary = Object.values(yearMap).map(y => ({
    ...y,
    posts: byYearMap[y.year] || 0,
    covered: y.weekdays - y.gaps,
    coverage: y.weekdays ? Math.round(1000 * (y.weekdays - y.gaps) / y.weekdays) / 10 : 0,
  }));
  const totalGaps = weekdays.filter(w => w.posts === 0).length;
  return { summary, ranges, totalGaps, totalWeekdays: weekdays.length };
}

const waybackURL = (day, host) => `https://web.archive.org/web/${day.replace(/-/g,"")}000000*/${host || "powerpage.org"}`;

function Gaps({ stats, db }) {
  const gap = useMemo(() => computeGapStats(stats.byDay, stats.byYear), [stats.byDay, stats.byYear]);
  const [drafts, setDrafts] = useState([]);
  useEffect(() => {
    if (!db) { setDrafts([]); return; }
    try {
      const r = execDb(db, "SELECT ID, post_title, post_date, post_modified FROM wp_posts WHERE post_status='draft' AND post_type='post' ORDER BY post_modified DESC LIMIT 200");
      setDrafts(r.rows || []);
    } catch (e) { setDrafts([]); }
  }, [db]);

  const coverageColor = pct => pct >= 95 ? K.green : pct >= 60 ? K.gold : pct >= 20 ? "#c97b3a" : K.red;
  const totalCoverage = gap.totalWeekdays ? Math.round(1000 * (gap.totalWeekdays - gap.totalGaps) / gap.totalWeekdays) / 10 : 0;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontFamily: "Georgia,serif", fontSize: 24, fontWeight: 700, letterSpacing: -.5 }}>
          Coverage Gaps
        </h2>
        <span style={{ fontFamily: "monospace", fontSize: 11, color: K.muted }}>
          weekday-zero days between 1995-12-01 and today · weekends excluded
        </span>
      </div>

      {/* Top stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 18 }}>
        {[
          { label: "Weekdays Tracked", value: gap.totalWeekdays.toLocaleString(), color: K.text },
          { label: "Gap Weekdays",     value: gap.totalGaps.toLocaleString(),     color: K.red },
          { label: "Overall Coverage", value: `${totalCoverage}%`,                color: coverageColor(totalCoverage) },
          { label: "Distinct Ranges",  value: gap.ranges.length.toLocaleString(), color: K.gold },
        ].map(s => (
          <div key={s.label} style={{ background: K.card, border: `1px solid ${K.border}`, borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: K.muted, textTransform: "uppercase", letterSpacing: 2, fontFamily: "monospace", marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color, fontFamily: "Georgia,serif" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Coverage by year */}
      <div style={{ background: K.card, border: `1px solid ${K.border}`, borderRadius: 10, padding: "16px 18px", marginBottom: 14 }}>
        <p style={{ margin: "0 0 12px", fontSize: 9, fontWeight: 700, color: K.muted, textTransform: "uppercase", letterSpacing: 2, fontFamily: "monospace" }}>
          Weekday Coverage by Year
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={gap.summary} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={K.dim} vertical={false} />
            <XAxis dataKey="year" stroke={K.muted} fontSize={10} tickLine={false} />
            <YAxis stroke={K.muted} fontSize={10} tickLine={false} domain={[0,100]} unit="%" />
            <Tooltip
              contentStyle={{ background: K.ink, border: `1px solid ${K.border}`, borderRadius: 6, fontFamily: "monospace", fontSize: 11 }}
              labelStyle={{ color: K.text }}
              formatter={(v, _, p) => [`${v}%  (${p.payload.covered}/${p.payload.weekdays} weekdays · ${p.payload.posts} posts)`, "coverage"]}
            />
            <Bar dataKey="coverage" fill={K.gold} radius={[2,2,0,0]}>
              {gap.summary.map((d,i) => (
                <rect key={i} fill={coverageColor(d.coverage)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Top gap ranges */}
      <div style={{ background: K.card, border: `1px solid ${K.border}`, borderRadius: 10, padding: "16px 18px", marginBottom: 14 }}>
        <p style={{ margin: "0 0 12px", fontSize: 9, fontWeight: 700, color: K.muted, textTransform: "uppercase", letterSpacing: 2, fontFamily: "monospace" }}>
          Largest Contiguous Gap Ranges · top 25
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 12 }}>
            <thead>
              <tr style={{ color: K.muted, borderBottom: `1px solid ${K.border}` }}>
                <th style={{ textAlign: "left",  padding: "8px 6px", fontWeight: 600 }}>Start</th>
                <th style={{ textAlign: "left",  padding: "8px 6px", fontWeight: 600 }}>End</th>
                <th style={{ textAlign: "right", padding: "8px 6px", fontWeight: 600 }}>Weekdays</th>
                <th style={{ textAlign: "right", padding: "8px 6px", fontWeight: 600 }}>Approx</th>
                <th style={{ textAlign: "left",  padding: "8px 6px", fontWeight: 600 }}>Wayback</th>
              </tr>
            </thead>
            <tbody>
              {gap.ranges.slice(0, 25).map((r, i) => {
                const months = Math.round(r.weekdays / 21 * 10) / 10;
                return (
                  <tr key={i} style={{ borderBottom: `1px solid ${K.dim}`, color: K.text }}>
                    <td style={{ padding: "6px" }}>{r.start}</td>
                    <td style={{ padding: "6px" }}>{r.end}</td>
                    <td style={{ padding: "6px", textAlign: "right", color: r.weekdays > 100 ? K.red : K.gold }}>{r.weekdays.toLocaleString()}</td>
                    <td style={{ padding: "6px", textAlign: "right", color: K.muted }}>{months < 1 ? `${r.weekdays}d` : `${months}mo`}</td>
                    <td style={{ padding: "6px" }}>
                      <a href={waybackURL(r.start)} target="_blank" rel="noreferrer" style={{ color: K.blue, textDecoration: "none" }}>↗ snapshots</a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drafts */}
      {drafts.length > 0 && (
        <div style={{ background: K.card, border: `1px solid ${K.border}`, borderRadius: 10, padding: "16px 18px" }}>
          <p style={{ margin: "0 0 12px", fontSize: 9, fontWeight: 700, color: K.muted, textTransform: "uppercase", letterSpacing: 2, fontFamily: "monospace" }}>
            Unpublished Drafts · {drafts.length} (recoverable without research)
          </p>
          <div style={{ maxHeight: 320, overflowY: "auto", fontFamily: "monospace", fontSize: 12 }}>
            {drafts.map(d => (
              <div key={d.ID} style={{ display: "flex", gap: 12, padding: "6px 4px", borderBottom: `1px solid ${K.dim}` }}>
                <span style={{ color: K.muted, minWidth: 90 }}>{(d.post_modified || d.post_date || "").slice(0,10)}</span>
                <span style={{ color: K.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.post_title || <em style={{ color: K.muted }}>(untitled)</em>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Hunter tab ───────────────────────────────────────────────────────────────
const BRAILLE_FRAMES = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
const BAR_FRAMES = ["▏","▎","▍","▌","▋","▊","▉","█","▉","▊","▋","▌","▍","▎"];

function useTick(interval = 110) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT(x => x + 1), interval);
    return () => clearInterval(id);
  }, [interval]);
  return t;
}

function Spinner({ offset = 0, color, char }) {
  const t = useTick(110);
  return <span style={{ color, fontFamily: "monospace", display: "inline-block", width: "1ch", textAlign: "center" }}>
    {char ?? BRAILLE_FRAMES[(t + offset) % BRAILLE_FRAMES.length]}
  </span>;
}

function Hunter({ db, onReload }) {
  const [state, setState] = useState(null);

  useEffect(() => {
    if (!db) { setState(null); return; }
    const q = sql => { try { return execDb(db, sql).rows || []; } catch (e) { return []; } };
    const scalar = (sql, d = 0) => q(sql)[0]?.n ?? d;

    const tableExists = name => q(`SELECT name n FROM sqlite_master WHERE type='table' AND name='${name}'`).length > 0;
    const hasCandidates = tableExists("peq_recovery_candidates");
    const hasRecovered  = tableExists("peq_posts_recovered");
    const hasTelemetry  = tableExists("hunter_telemetry");
    const hasProposals  = tableExists("hunter_proposals");

    setState({
      hasCandidates, hasRecovered, hasTelemetry, hasProposals,
      candByStatus: hasCandidates ? q(`SELECT status, COUNT(*) n FROM peq_recovery_candidates GROUP BY status ORDER BY n DESC`) : [],
      candTotal:    hasCandidates ? scalar(`SELECT COUNT(*) n FROM peq_recovery_candidates`) : 0,
      candByHint:   hasCandidates ? q(`SELECT hint, COUNT(*) n FROM peq_recovery_candidates GROUP BY hint ORDER BY n DESC`) : [],
      candByYear:   hasCandidates ? q(`SELECT substr(inferred_date,1,4) yr, COUNT(*) n FROM peq_recovery_candidates WHERE inferred_date IS NOT NULL GROUP BY yr ORDER BY yr`) : [],
      candByConf:   hasCandidates ? q(`
        SELECT
          CASE WHEN confidence >= 0.9 THEN 'high (>=0.9)'
               WHEN confidence >= 0.7 THEN 'med  (>=0.7)'
               WHEN confidence >= 0.5 THEN 'low  (>=0.5)'
               ELSE 'minimal (<0.5)' END AS bucket,
          COUNT(*) n
        FROM peq_recovery_candidates WHERE status='pending' GROUP BY bucket`) : [],
      recovered: hasRecovered ? q(`
        SELECT id, proposed_post_date, proposed_post_title, proposed_post_author,
               source, source_url, source_original_url, confidence, reviewed, created_at
        FROM peq_posts_recovered ORDER BY id DESC LIMIT 25`) : [],
      recoveredCounts: hasRecovered ? q(`SELECT reviewed, COUNT(*) n FROM peq_posts_recovered GROUP BY reviewed`) : [],
      // Live activity log: most-recent fetched/failed events, unified and sorted desc
      activity: (hasRecovered || hasCandidates) ? q(`
        SELECT created_at ts, 'ok' kind, source, source_original_url url,
               proposed_post_title title, proposed_post_date date, NULL reason
          FROM peq_posts_recovered
          WHERE created_at IS NOT NULL
        UNION ALL
        SELECT created_at ts, 'fail' kind, 'wayback' source, original_url url,
               NULL title, inferred_date date, substr(fail_reason,1,80) reason
          FROM peq_recovery_candidates
          WHERE status='failed' AND fail_reason IS NOT NULL
        ORDER BY ts DESC
        LIMIT 40
      `) : [],
      latestTs: hasRecovered ? scalar(`SELECT MAX(created_at) n FROM peq_posts_recovered`, null) : null,
      telemetry: hasTelemetry ? q(`
        SELECT source,
               SUM(enumerated) enumerated,
               SUM(fetched_ok) fetched_ok,
               SUM(fetched_fail) fetched_fail,
               SUM(accepted) accepted,
               SUM(rejected) rejected,
               MAX(day) last_day
        FROM hunter_telemetry GROUP BY source ORDER BY accepted DESC`) : [],
      proposals: hasProposals ? q(`
        SELECT id, created_at, kind, title, status
        FROM hunter_proposals WHERE status='open' ORDER BY created_at DESC LIMIT 20`) : [],
    });
  }, [db]);

  if (!db) {
    return (
      <div style={{ textAlign: "center", padding: "70px 0", color: K.muted }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🎯</div>
        <p style={{ fontFamily: "monospace", fontSize: 13 }}>Hunter requires a real .sqlite file.</p>
        <p style={{ fontFamily: "monospace", fontSize: 11, marginTop: 6, color: K.border }}>
          Drop your <code style={{ background: K.dim, padding: "1px 5px", borderRadius: 3, color: K.text }}>powerpage.db</code> via the 📂 button.
        </p>
      </div>
    );
  }

  if (!state) return <div style={{ color: K.muted, fontFamily: "monospace", fontSize: 12, padding: 20 }}>loading…</div>;

  // Cold-start empty state — neither recovery table exists yet
  if (!state.hasCandidates && !state.hasRecovered) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontFamily: "Georgia,serif", fontSize: 24, fontWeight: 700, letterSpacing: -.5 }}>Hunter</h2>
          <span style={{ fontFamily: "monospace", fontSize: 11, color: K.muted }}>archive recovery pipeline · not yet initialized</span>
        </div>
        <div style={{ background: K.card, border: `1px solid ${K.border}`, borderRadius: 10, padding: "30px 32px", textAlign: "left", lineHeight: 1.65 }}>
          <p style={{ margin: "0 0 12px", fontFamily: "monospace", fontSize: 13, color: K.text }}>
            The recovery pipeline tables don't exist yet in this database.
          </p>
          <p style={{ margin: "0 0 18px", fontFamily: "monospace", fontSize: 12, color: K.muted }}>
            Run the Wayback scraper to populate <code style={{ background: K.dim, padding: "1px 5px", borderRadius: 3, color: K.text }}>peq_recovery_candidates</code> and <code style={{ background: K.dim, padding: "1px 5px", borderRadius: 3, color: K.text }}>peq_posts_recovered</code>:
          </p>
          <pre style={{ background: K.ink, border: `1px solid ${K.dim}`, borderRadius: 6, padding: "12px 14px", fontFamily: "monospace", fontSize: 12, color: K.gold, margin: "0 0 20px", overflowX: "auto" }}>
{`bin/wayback-recover.py enumerate
bin/wayback-recover.py fetch --limit 100`}
          </pre>
          <p style={{ margin: 0, fontFamily: "monospace", fontSize: 11, color: K.muted }}>
            Full design and the 24/7 daemon roadmap: <a href="https://github.com/jasonogrady/pp-twin/blob/main/HUNTER.md" target="_blank" rel="noreferrer" style={{ color: K.blue, textDecoration: "none" }}>HUNTER.md ↗</a>
          </p>
        </div>
      </div>
    );
  }

  const pending  = state.candByStatus.find(r => r.status === "pending")?.n  || 0;
  const fetched  = state.candByStatus.find(r => r.status === "fetched")?.n  || 0;
  const failed   = state.candByStatus.find(r => r.status === "failed")?.n   || 0;
  const inReview = state.recoveredCounts.find(r => r.reviewed === 0)?.n  || 0;
  const accepted = state.recoveredCounts.find(r => r.reviewed === 1)?.n  || 0;
  const rejected = state.recoveredCounts.find(r => r.reviewed === -1)?.n || 0;

  const Card = ({ label, value, color }) => (
    <div style={{ background: K.card, border: `1px solid ${K.border}`, borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: K.muted, textTransform: "uppercase", letterSpacing: 2, fontFamily: "monospace", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || K.text, fontFamily: "Georgia,serif" }}>{value}</div>
    </div>
  );

  const SectionHeader = ({ children, right }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, flexWrap: "wrap", gap: 6 }}>
      <p style={{ margin: 0, fontSize: 9, fontWeight: 700, color: K.muted, textTransform: "uppercase", letterSpacing: 2, fontFamily: "monospace" }}>{children}</p>
      {right}
    </div>
  );

  // Live-ness heuristic: anything fetched within the last 5 minutes counts as "active".
  const ageSec = state.latestTs
    ? Math.max(0, (Date.now() - new Date(state.latestTs.replace(" ", "T") + "Z").getTime()) / 1000)
    : null;
  const isActive = ageSec !== null && ageSec < 300;
  const ageLabel = ageSec === null
    ? "no fetches yet"
    : ageSec < 60   ? `${Math.round(ageSec)}s ago`
    : ageSec < 3600 ? `${Math.round(ageSec/60)}m ago`
    : ageSec < 86400 ? `${Math.round(ageSec/3600)}h ago`
    : `${Math.round(ageSec/86400)}d ago`;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontFamily: "Georgia,serif", fontSize: 24, fontWeight: 700, letterSpacing: -.5 }}>Hunter</h2>
        <span style={{ fontFamily: "monospace", fontSize: 11, color: K.muted }}>
          archive recovery pipeline · staged → fetched → review
        </span>
        <div style={{ marginLeft: "auto" }}>
          <label style={{ cursor: "pointer", padding: "4px 12px", border: `1px solid ${K.b2}`, borderRadius: 5, fontSize: 11, color: K.muted, fontFamily: "monospace" }}
            onMouseEnter={e => e.currentTarget.style.borderColor = K.gold}
            onMouseLeave={e => e.currentTarget.style.borderColor = K.b2}>
            🔄 Reload DB
            <input type="file" accept=".db,.sqlite,.sqlite3" style={{ display: "none" }}
              onChange={e => onReload && e.target.files[0] && onReload(e.target.files[0])} />
          </label>
        </div>
      </div>

      {/* Live status strip — animated braille, derived from snapshot but visually alive */}
      <div style={{
        background: K.ink, border: `1px solid ${isActive ? K.gold : K.border}`, borderRadius: 10,
        padding: "12px 16px", marginBottom: 14, fontFamily: "monospace", fontSize: 12,
        display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap"
      }}>
        <Spinner offset={0} color={isActive ? K.gold : K.muted}/>
        <span style={{ color: isActive ? K.gold : K.muted, fontWeight: 700, letterSpacing: 1 }}>
          {isActive ? "ACTIVE" : "IDLE"}
        </span>
        <span style={{ color: K.border }}>·</span>
        <span style={{ color: K.text }}>{state.candTotal.toLocaleString()} candidates</span>
        <span style={{ color: K.border }}>·</span>
        <span style={{ color: K.blue }}>
          <Spinner offset={3} color={K.blue}/> {fetched.toLocaleString()} fetched
        </span>
        <span style={{ color: K.border }}>·</span>
        <span style={{ color: K.gold }}>
          <Spinner offset={6} color={K.gold}/> {pending.toLocaleString()} pending
        </span>
        {failed > 0 && <>
          <span style={{ color: K.border }}>·</span>
          <span style={{ color: K.red }}>✗ {failed.toLocaleString()} failed</span>
        </>}
        <span style={{ marginLeft: "auto", color: K.muted, fontSize: 11 }}>
          last fetch: <span style={{ color: isActive ? K.gold : K.muted }}>{ageLabel}</span>
        </span>
      </div>

      {/* Live Activity log */}
      {state.activity.length > 0 && (
        <div style={{ background: K.card, border: `1px solid ${K.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 14 }}>
          <SectionHeader right={
            <span style={{ fontFamily: "monospace", fontSize: 10, color: K.muted }}>
              tail · last {state.activity.length} events · snapshot at load time
            </span>
          }>Live Activity</SectionHeader>
          <div style={{
            background: K.ink, border: `1px solid ${K.dim}`, borderRadius: 6,
            padding: "10px 12px", fontFamily: "monospace", fontSize: 11,
            maxHeight: 280, overflowY: "auto", lineHeight: 1.55,
          }}>
            {state.activity.map((row, i) => {
              const ok = row.kind === "ok";
              const ts = (row.ts || "").slice(11, 19);
              return (
                <div key={i} style={{ display: "flex", gap: 8, color: ok ? K.text : K.muted, whiteSpace: "nowrap", overflow: "hidden" }}>
                  <Spinner offset={i} color={ok ? K.green : K.red}/>
                  <span style={{ color: K.muted, minWidth: 72 }}>{ts}</span>
                  <span style={{ color: ok ? K.green : K.red, minWidth: 18 }}>{ok ? "✓" : "✗"}</span>
                  <span style={{ color: K.blue, minWidth: 60 }}>{row.source}</span>
                  <span style={{ color: K.muted, minWidth: 88 }}>{(row.date || "").slice(0, 10)}</span>
                  <span style={{ flex: 1, color: ok ? K.text : K.red, textOverflow: "ellipsis", overflow: "hidden" }}>
                    {ok
                      ? (row.title || row.url)
                      : `${row.url} → ${row.reason || "(no reason)"}`
                    }
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 8, fontFamily: "monospace", fontSize: 10, color: K.border }}>
            Hit <strong style={{ color: K.gold }}>🔄 Reload DB</strong> after running <code style={{ background: K.dim, padding: "1px 5px", borderRadius: 3, color: K.muted }}>bin/wayback-recover.py fetch</code> to see new entries.
          </div>
        </div>
      )}

      {/* Top metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 18 }}>
        <Card label="Candidates"     value={state.candTotal.toLocaleString()} color={K.text} />
        <Card label="Pending Fetch"  value={pending.toLocaleString()}         color={K.gold} />
        <Card label="Fetched"        value={fetched.toLocaleString()}         color={K.blue} />
        <Card label="Failed"         value={failed.toLocaleString()}          color={failed > 0 ? K.red : K.muted} />
        <Card label="In Review"      value={inReview.toLocaleString()}        color={inReview > 0 ? K.gold : K.muted} />
        <Card label="Accepted"       value={accepted.toLocaleString()}        color={K.green} />
        <Card label="Rejected"       value={rejected.toLocaleString()}        color={K.muted} />
      </div>

      {/* Sources (live telemetry once daemon exists, otherwise stub) */}
      <div style={{ background: K.card, border: `1px solid ${K.border}`, borderRadius: 10, padding: "16px 18px", marginBottom: 14 }}>
        <SectionHeader right={
          <span style={{ fontFamily: "monospace", fontSize: 10, color: K.muted }}>
            {state.hasTelemetry ? `${state.telemetry.length} active` : "daemon not yet running — populated by hunter_telemetry"}
          </span>
        }>Sources</SectionHeader>
        {state.hasTelemetry && state.telemetry.length > 0 ? (
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 12 }}>
            <thead>
              <tr style={{ color: K.muted, borderBottom: `1px solid ${K.border}` }}>
                <th style={{ textAlign: "left",  padding: "8px 6px", fontWeight: 600 }}>Source</th>
                <th style={{ textAlign: "right", padding: "8px 6px", fontWeight: 600 }}>Enumerated</th>
                <th style={{ textAlign: "right", padding: "8px 6px", fontWeight: 600 }}>Fetched</th>
                <th style={{ textAlign: "right", padding: "8px 6px", fontWeight: 600 }}>Failed</th>
                <th style={{ textAlign: "right", padding: "8px 6px", fontWeight: 600 }}>Accepted</th>
                <th style={{ textAlign: "right", padding: "8px 6px", fontWeight: 600 }}>Accept %</th>
                <th style={{ textAlign: "left",  padding: "8px 6px", fontWeight: 600 }}>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {state.telemetry.map(t => {
                const total = (t.accepted || 0) + (t.rejected || 0);
                const rate = total > 0 ? Math.round(100 * t.accepted / total) : null;
                return (
                  <tr key={t.source} style={{ borderBottom: `1px solid ${K.dim}`, color: K.text }}>
                    <td style={{ padding: "6px", color: K.gold }}>{t.source}</td>
                    <td style={{ padding: "6px", textAlign: "right" }}>{(t.enumerated || 0).toLocaleString()}</td>
                    <td style={{ padding: "6px", textAlign: "right", color: K.blue }}>{(t.fetched_ok || 0).toLocaleString()}</td>
                    <td style={{ padding: "6px", textAlign: "right", color: t.fetched_fail > 0 ? K.red : K.muted }}>{(t.fetched_fail || 0).toLocaleString()}</td>
                    <td style={{ padding: "6px", textAlign: "right", color: K.green }}>{(t.accepted || 0).toLocaleString()}</td>
                    <td style={{ padding: "6px", textAlign: "right", color: K.muted }}>{rate !== null ? `${rate}%` : "—"}</td>
                    <td style={{ padding: "6px", color: K.muted }}>{t.last_day || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div style={{ fontFamily: "monospace", fontSize: 12, color: K.muted, padding: "10px 4px" }}>
            {[
              ["wayback",      "archive.org CDX scraper — bin/wayback-recover.py exists"],
              ["archive.today","not built"],
              ["common_crawl", "not built"],
              ["macrumors",    "not built"],
              ["local_mail",   "not built — mdfind Mail.app + Gmail Takeout"],
              ["local_backups","not built — mdfind /Volumes"],
            ].map(([name, note]) => (
              <div key={name} style={{ display: "flex", gap: 12, padding: "3px 0", borderBottom: `1px solid ${K.dim}` }}>
                <span style={{ color: K.gold, minWidth: 120 }}>{name}</span>
                <span>{note}</span>
              </div>
            ))}
            <div style={{ marginTop: 10, color: K.border }}>
              See <a href="https://github.com/jasonogrady/pp-twin/blob/main/HUNTER.md" target="_blank" rel="noreferrer" style={{ color: K.blue, textDecoration: "none" }}>HUNTER.md ↗</a> for the source-adapter design.
            </div>
          </div>
        )}
      </div>

      {/* Distributions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
        {/* Confidence */}
        <div style={{ background: K.card, border: `1px solid ${K.border}`, borderRadius: 10, padding: "14px 16px" }}>
          <SectionHeader>Confidence · pending</SectionHeader>
          {state.candByConf.length === 0 ? (
            <div style={{ fontFamily: "monospace", fontSize: 11, color: K.muted }}>no pending candidates</div>
          ) : state.candByConf.map(r => (
            <div key={r.bucket} style={{ display: "flex", justifyContent: "space-between", fontFamily: "monospace", fontSize: 12, padding: "4px 0", borderBottom: `1px solid ${K.dim}` }}>
              <span style={{ color: K.text }}>{r.bucket}</span>
              <span style={{ color: K.gold }}>{r.n.toLocaleString()}</span>
            </div>
          ))}
        </div>

        {/* Hint */}
        <div style={{ background: K.card, border: `1px solid ${K.border}`, borderRadius: 10, padding: "14px 16px" }}>
          <SectionHeader>URL Patterns Matched</SectionHeader>
          {state.candByHint.length === 0 ? (
            <div style={{ fontFamily: "monospace", fontSize: 11, color: K.muted }}>nothing staged</div>
          ) : state.candByHint.slice(0, 10).map(r => (
            <div key={r.hint || "(none)"} style={{ display: "flex", justifyContent: "space-between", fontFamily: "monospace", fontSize: 12, padding: "4px 0", borderBottom: `1px solid ${K.dim}` }}>
              <span style={{ color: K.text }}>{r.hint || <em style={{ color: K.muted }}>(none)</em>}</span>
              <span style={{ color: K.gold }}>{r.n.toLocaleString()}</span>
            </div>
          ))}
        </div>

        {/* Year */}
        <div style={{ background: K.card, border: `1px solid ${K.border}`, borderRadius: 10, padding: "14px 16px" }}>
          <SectionHeader>Inferred Date · by Year</SectionHeader>
          {state.candByYear.length === 0 ? (
            <div style={{ fontFamily: "monospace", fontSize: 11, color: K.muted }}>no dated candidates</div>
          ) : (
            <div style={{ maxHeight: 220, overflowY: "auto" }}>
              {state.candByYear.map(r => (
                <div key={r.yr} style={{ display: "flex", justifyContent: "space-between", fontFamily: "monospace", fontSize: 12, padding: "3px 0", borderBottom: `1px solid ${K.dim}` }}>
                  <span style={{ color: K.text }}>{r.yr}</span>
                  <span style={{ color: K.gold }}>{r.n.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Open proposals (hunter_proposals — daemon-only) */}
      {state.hasProposals && state.proposals.length > 0 && (
        <div style={{ background: K.card, border: `1px solid ${K.border}`, borderRadius: 10, padding: "16px 18px", marginBottom: 14 }}>
          <SectionHeader right={<span style={{ fontFamily: "monospace", fontSize: 10, color: K.muted }}>self-improvement suggestions from the daemon</span>}>
            Open Proposals · {state.proposals.length}
          </SectionHeader>
          {state.proposals.map(p => (
            <div key={p.id} style={{ display: "flex", gap: 12, padding: "8px 4px", borderBottom: `1px solid ${K.dim}`, fontFamily: "monospace", fontSize: 12 }}>
              <span style={{ color: K.muted, minWidth: 100 }}>{(p.created_at || "").slice(0, 10)}</span>
              <span style={{ color: K.blue, minWidth: 90 }}>{p.kind}</span>
              <span style={{ color: K.text, flex: 1 }}>{p.title}</span>
            </div>
          ))}
        </div>
      )}

      {/* Review queue */}
      <div style={{ background: K.card, border: `1px solid ${K.border}`, borderRadius: 10, padding: "16px 18px" }}>
        <SectionHeader right={<span style={{ fontFamily: "monospace", fontSize: 10, color: K.muted }}>{inReview > 25 ? `showing 25 of ${inReview}` : `${state.recovered.length} total`}</span>}>
          Review Queue
        </SectionHeader>
        {state.recovered.length === 0 ? (
          <div style={{ fontFamily: "monospace", fontSize: 12, color: K.muted, padding: "10px 4px" }}>
            No recovered posts yet. Run <code style={{ background: K.dim, padding: "1px 5px", borderRadius: 3, color: K.text }}>bin/wayback-recover.py fetch</code> to populate.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 12 }}>
              <thead>
                <tr style={{ color: K.muted, borderBottom: `1px solid ${K.border}` }}>
                  <th style={{ textAlign: "left",  padding: "8px 6px", fontWeight: 600 }}>Date</th>
                  <th style={{ textAlign: "left",  padding: "8px 6px", fontWeight: 600 }}>Title</th>
                  <th style={{ textAlign: "left",  padding: "8px 6px", fontWeight: 600 }}>Author</th>
                  <th style={{ textAlign: "left",  padding: "8px 6px", fontWeight: 600 }}>Source</th>
                  <th style={{ textAlign: "right", padding: "8px 6px", fontWeight: 600 }}>Conf</th>
                  <th style={{ textAlign: "left",  padding: "8px 6px", fontWeight: 600 }}>State</th>
                  <th style={{ textAlign: "left",  padding: "8px 6px", fontWeight: 600 }}>Link</th>
                </tr>
              </thead>
              <tbody>
                {state.recovered.map(r => {
                  const stateLabel = r.reviewed === 1 ? "accepted" : r.reviewed === -1 ? "rejected" : "pending";
                  const stateColor = r.reviewed === 1 ? K.green : r.reviewed === -1 ? K.red : K.gold;
                  return (
                    <tr key={r.id} style={{ borderBottom: `1px solid ${K.dim}`, color: K.text }}>
                      <td style={{ padding: "6px", color: K.muted, whiteSpace: "nowrap" }}>{(r.proposed_post_date || "").slice(0, 10)}</td>
                      <td style={{ padding: "6px", maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.proposed_post_title || ""}>
                        {r.proposed_post_title || <em style={{ color: K.muted }}>(no title)</em>}
                      </td>
                      <td style={{ padding: "6px", color: K.muted }}>{r.proposed_post_author || "—"}</td>
                      <td style={{ padding: "6px", color: K.blue }}>{r.source}</td>
                      <td style={{ padding: "6px", textAlign: "right", color: K.muted }}>{r.confidence != null ? r.confidence.toFixed(2) : "—"}</td>
                      <td style={{ padding: "6px", color: stateColor }}>{stateLabel}</td>
                      <td style={{ padding: "6px" }}>
                        {r.source_url && <a href={r.source_url} target="_blank" rel="noreferrer" style={{ color: K.blue, textDecoration: "none" }}>↗</a>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: 12, fontFamily: "monospace", fontSize: 10, color: K.border }}>
          Accept/reject controls are read-only here for now. Apply decisions via SQL:
          <code style={{ background: K.dim, padding: "1px 5px", borderRadius: 3, color: K.muted, marginLeft: 6 }}>UPDATE peq_posts_recovered SET reviewed = 1 WHERE id = …</code>
        </div>
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
const getDbTables=db=>execDb(db,"SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").rows.map(r=>r.name);
const isWP=ts=>ts.includes("wp_posts")&&ts.includes("wp_users");
const wpStats=db=>{
  const q=s=>{try{return execDb(db,s).rows;}catch(e){return[];}};
  const scalar=(s,d=0)=>{try{return execDb(db,s).rows[0]?.n??d;}catch(e){return d;}};
  const yrNow=new Date().getFullYear();
  return{
    total:scalar("SELECT COUNT(*) n FROM wp_posts WHERE post_status='publish' AND post_type='post'"),
    byAuthor:q(`SELECT u.display_name author,COUNT(*) count FROM wp_posts p JOIN wp_users u ON p.post_author=u.ID WHERE p.post_status='publish' AND p.post_type='post' GROUP BY p.post_author ORDER BY count DESC LIMIT 20`),
    byMonth:q(`SELECT strftime('%Y-%m',post_date) month,COUNT(*) count FROM wp_posts WHERE post_status='publish' AND post_type='post' GROUP BY month ORDER BY month`),
    byYear:q(`SELECT strftime('%Y',post_date) year,COUNT(*) count FROM wp_posts WHERE post_status='publish' AND post_type='post' GROUP BY year ORDER BY year`),
    byCat:q(`SELECT t.name cat,COUNT(*) count FROM wp_posts p JOIN wp_term_relationships tr ON p.ID=tr.object_id JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id=tt.term_taxonomy_id JOIN wp_terms t ON tt.term_id=t.term_id WHERE tt.taxonomy='category' AND p.post_status='publish' AND p.post_type='post' GROUP BY t.term_id ORDER BY count DESC LIMIT 15`),
    byTag:q(`SELECT t.name tag, tt.count count FROM wp_terms t JOIN wp_term_taxonomy tt ON t.term_id=tt.term_id WHERE tt.taxonomy='post_tag' AND tt.count > 0 ORDER BY tt.count DESC LIMIT 20`),
    recent:q(`SELECT p.post_title title,p.post_date date,u.display_name author FROM wp_posts p JOIN wp_users u ON p.post_author=u.ID WHERE p.post_status='publish' AND p.post_type='post' ORDER BY p.post_date DESC LIMIT 10`),
    byDay:q(`SELECT date(post_date) day,COUNT(*) count FROM wp_posts WHERE post_status='publish' AND post_type='post' GROUP BY day ORDER BY day`),
    // Editorial metrics
    thisYearCount: scalar(`SELECT COUNT(*) n FROM wp_posts WHERE post_status='publish' AND post_type='post' AND strftime('%Y',post_date)='${yrNow}'`),
    lastYearCount: scalar(`SELECT COUNT(*) n FROM wp_posts WHERE post_status='publish' AND post_type='post' AND strftime('%Y',post_date)='${yrNow-1}'`),
    avgPostLen:    scalar(`SELECT CAST(AVG(LENGTH(post_content)) AS INTEGER) n FROM wp_posts WHERE post_status='publish' AND post_type='post'`),
    authorsActiveThisYear: scalar(`SELECT COUNT(DISTINCT post_author) n FROM wp_posts WHERE post_status='publish' AND post_type='post' AND strftime('%Y',post_date)='${yrNow}'`),
    topAuthorThisYear: q(`SELECT u.display_name author,COUNT(*) count FROM wp_posts p JOIN wp_users u ON p.post_author=u.ID WHERE p.post_status='publish' AND p.post_type='post' AND strftime('%Y',p.post_date)='${yrNow}' GROUP BY p.post_author ORDER BY count DESC LIMIT 1`)[0],
    topCatThisYear: q(`SELECT t.name cat,COUNT(*) count FROM wp_posts p JOIN wp_term_relationships tr ON p.ID=tr.object_id JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id=tt.term_taxonomy_id JOIN wp_terms t ON tt.term_id=t.term_id WHERE tt.taxonomy='category' AND p.post_status='publish' AND p.post_type='post' AND strftime('%Y',p.post_date)='${yrNow}' GROUP BY t.term_id ORDER BY count DESC LIMIT 1`)[0],
    topTagThisYear: q(`SELECT t.name tag,COUNT(*) count FROM wp_posts p JOIN wp_term_relationships tr ON p.ID=tr.object_id JOIN wp_term_taxonomy tt ON tr.term_taxonomy_id=tt.term_taxonomy_id JOIN wp_terms t ON tt.term_id=t.term_id WHERE tt.taxonomy='post_tag' AND p.post_status='publish' AND p.post_type='post' AND strftime('%Y',p.post_date)='${yrNow}' GROUP BY t.term_id ORDER BY count DESC LIMIT 1`)[0],
    byWeek: q(`SELECT strftime('%Y-W%W', post_date) week, COUNT(*) count FROM wp_posts WHERE post_status='publish' AND post_type='post' GROUP BY week ORDER BY week`),
    // Engagement (comments)
    totalComments: scalar(`SELECT COUNT(*) n FROM wp_comments WHERE comment_approved='1' AND comment_type IN ('','comment')`),
    postsWithComments: scalar(`SELECT COUNT(DISTINCT comment_post_ID) n FROM wp_comments WHERE comment_approved='1' AND comment_type IN ('','comment')`),
    postsWith10Plus: scalar(`SELECT COUNT(*) n FROM (SELECT comment_post_ID FROM wp_comments WHERE comment_approved='1' AND comment_type IN ('','comment') GROUP BY comment_post_ID HAVING COUNT(*)>=10)`),
    topComments: q(`SELECT p.post_title title, p.post_date date, COUNT(*) comments FROM wp_comments c JOIN wp_posts p ON c.comment_post_ID=p.ID WHERE c.comment_approved='1' AND c.comment_type IN ('','comment') AND p.post_status='publish' AND p.post_type='post' GROUP BY p.ID ORDER BY comments DESC LIMIT 5`),
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
  const [bootMsg, setBootMsg] = useState("Connecting…");
  const [bootProgress, setBootProgress] = useState(0);

  const loadFromBuffer=useCallback(async buf=>{
    setBootMsg("Parsing SQLite…");
    const SQL=await getSQL();
    const database=new SQL.Database(new Uint8Array(buf));
    const ts=getDbTables(database);
    if(isWP(ts)){
      setBootMsg("Running queries…");
      const s=wpStats(database);
      setStats({...s,isDemo:false});
      setTables2(ts);
      setDbInst(database);
      if(s.byYear.length)setYear(+s.byYear[Math.floor(s.byYear.length*.75)].year);
      return true;
    }else{
      setTables2(ts);
      setDbInst(database);
      setTab("explorer");
      return false;
    }
  },[]);

  // Boot with demo data immediately. Users load their real .sqlite via the 📂 button.
  useEffect(()=>{
    document.body.style.cssText="margin:0;padding:0;background:#090b08;";
    setStats(makeDemo());
  },[]);

  const loadFile=useCallback(async file=>{
    if(!file)return;
    setLoading(true);
    setBootMsg(`Reading ${file.name}…`);
    try{
      const buf=await file.arrayBuffer();
      await loadFromBuffer(buf);
    }catch(e){alert("Error: "+e.message);}
    setLoading(false);
    setBootMsg("Connecting…");
  },[loadFromBuffer]);

  const runQuery=useCallback(()=>{
    if(!dbInst)return;
    setQRes(execDb(dbInst,sql));
  },[dbInst,sql]);

  if(!stats || loading) {
    const pct = Math.round(bootProgress * 100);
    const indeterminate = bootProgress === 0;
    return (
      <div style={{background:K.bg,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",color:K.text,fontFamily:"monospace",padding:20}}>
        <style>{`@keyframes pp-pulse{0%{transform:translateX(-100%)}100%{transform:translateX(320px)}}`}</style>
        <div style={{fontFamily:"Georgia,serif",fontSize:32,fontWeight:700,marginBottom:6}}>
          PowerPage<span style={{color:K.gold}}>.</span>
        </div>
        <div style={{fontSize:11,color:K.muted,marginBottom:18}}>pp-twin · local archive explorer</div>
        <div style={{width:320,height:6,background:K.dim,borderRadius:3,overflow:"hidden",marginBottom:10,position:"relative"}}>
          {indeterminate ? (
            <div style={{position:"absolute",top:0,left:0,width:80,height:"100%",background:K.gold,borderRadius:3,animation:"pp-pulse 1.2s ease-in-out infinite"}}/>
          ) : (
            <div style={{width:`${pct}%`,height:"100%",background:K.gold,transition:"width .15s"}}/>
          )}
        </div>
        <div style={{fontSize:12,color:K.gold}}>{bootMsg}</div>
        {!indeterminate && bootProgress < 1 && (
          <div style={{fontSize:10,color:K.muted,marginTop:4}}>{pct}%</div>
        )}
      </div>
    );
  }

  const TABS=[
    {id:"dashboard",label:"Dashboard"},
    {id:"explorer", label:"SQL Explorer"},
    {id:"calendar", label:"Post Calendar"},
    {id:"gaps",     label:"Gaps"},
    {id:"hunter",   label:"Hunter"},
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

      {/* Demo-mode banner */}
      {stats.isDemo && (
        <div style={{background:"#1a1810",borderBottom:`1px solid ${K.b2}`}}>
          <div style={{maxWidth:1480,margin:"0 auto",padding:"10px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
            <div style={{fontFamily:"monospace",fontSize:12,color:K.text}}>
              <span style={{color:K.gold,fontWeight:700,marginRight:6}}>⚡ Demo data</span>
              You're viewing 25 years of synthetic stats. Load your real <code style={{background:K.dim,padding:"1px 5px",borderRadius:3,color:K.text}}>powerpage.db</code> to see actual numbers.
            </div>
            <label style={{cursor:"pointer",padding:"5px 14px",background:K.gold,color:K.ink,border:"none",borderRadius:5,fontSize:12,fontFamily:"monospace",fontWeight:"bold",whiteSpace:"nowrap"}}>
              📂 Load powerpage.db
              <input type="file" accept=".db,.sqlite,.sqlite3" style={{display:"none"}} onChange={e=>loadFile(e.target.files[0])}/>
            </label>
          </div>
        </div>
      )}

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

        {tab==="gaps"&&(
          <Gaps stats={stats} db={dbInst}/>
        )}

        {tab==="hunter"&&(
          <Hunter db={dbInst} onReload={loadFile}/>
        )}

        {tab==="calendar"&&(
          <div>
            <EditorDashboard stats={stats}/>
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
