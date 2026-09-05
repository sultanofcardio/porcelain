// The sidebar and the roadmap page. Each block checks for its own elements, so this is safe on every page.
(function(){
  const R = window.ROADMAP || {AREAS: {}, NEXT: [], COLS: 22, ABOVE: 0, TOTAL: 0};
  const AREAS = R.AREAS;
  const NEXT = new Set(R.NEXT);
  (function(){ const hide=document.getElementById('navhide'), rail=document.getElementById('navrail'), site=document.querySelector('.site'); if(!hide) return;
    let c=false; try { c=localStorage.getItem('pc-nav')==='collapsed'; } catch(e) {}
    function set(v){ c=v; site.classList.toggle('collapsed',c); rail.hidden=!c; try { localStorage.setItem('pc-nav',c?'collapsed':'open'); } catch(e) {} requestAnimationFrame(()=>{ window.drawSeam && window.drawSeam(); window.drawLog && window.drawLog(); }); }
    set(c); hide.addEventListener('click',()=>set(true)); rail.addEventListener('click',()=>set(false)); })();
  document.querySelectorAll('[data-goto]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); show(a.dataset.goto); }));


  // CSS zoom (html { zoom }) scales getBoundingClientRect in current browsers but not offsetWidth or CSS lengths; rc() returns rects in CSS px.
  const zprobe=document.createElement('div'); zprobe.style.cssText='position:absolute;visibility:hidden;width:100px;height:1px;pointer-events:none;left:0;top:0'; document.body.appendChild(zprobe);
  const Z=()=>{ const w=zprobe.getBoundingClientRect().width; return w>0 ? w/100 : 1; };
  const rc=el=>{ const r=el.getBoundingClientRect(), z=Z(); return {left:r.left/z, top:r.top/z, right:r.right/z, bottom:r.bottom/z, width:r.width/z, height:r.height/z, x:r.x/z, y:r.y/z}; };
  // the glaze
  (function(){
    const cloth=document.getElementById('cloth'); if(!cloth) return;
    const grid=document.getElementById('cloth-grid'), areasEl=document.getElementById('cloth-areas'), seam=document.getElementById('seam'), tip=document.getElementById('tip');
    const body=cloth.querySelector('.cloth-body');
    const all=[...grid.querySelectorAll('.sq')];
    const COLS=R.COLS, ABOVE=R.ABOVE;
    const stageLabel={done:'Supported',v1:'Before 1.0',after:'After 1.0',never:'Not planned'};
    all.forEach(s=>{ if(NEXT.has(+s.dataset.n)) s.classList.add('next'); });
    function tones(){
      if(!areasEl.hidden){
        areasEl.querySelectorAll('.arow').forEach((row,ri)=>row.querySelectorAll('.sq').forEach((s,ci)=>s.classList.toggle('tb',(ri+ci)%2===1)));
      } else {
        all.forEach((s,i)=>s.classList.toggle('tb',(Math.floor(i/COLS)+i%COLS)%2===1));
      }
    }
    function drawSeam(){
      if(!areasEl.hidden || grid.offsetWidth===0){ seam.innerHTML=''; return; }
      const b=rc(body);
      const last=rc(all[ABOVE-1]), nextRow=rc(all[ABOVE]);
      const gap=(nextRow.left-last.right)/2; const x=last.right-b.left+gap; const yLow=last.bottom-b.top+gap; const yHigh=last.top-b.top-gap;
      const w=b.width;
      seam.setAttribute('viewBox',`0 0 ${w} ${b.height}`);
      const gw=rc(grid).right-b.left; const d2=`M0 ${yLow} H${x} V${yHigh} H${gw+10}`;
      seam.innerHTML=`<path class="under" d="${d2}"/><path class="over" d="${d2}"/><g transform="translate(${gw+12} ${yHigh-11})"><rect class="tag" width="38" height="22" rx="6"/><text class="tagtext" x="19" y="15" text-anchor="middle">1.0</text></g>`;
    }
    window.drawSeam=drawSeam;
    function flip(fn){
      const before=new Map(all.map(s=>[s,rc(s)]));
      fn();
      all.forEach(s=>{ const a=before.get(s), b=rc(s); const dx=a.left-b.left, dy=a.top-b.top; const k=a.width/b.width||1;
        s.style.transition='none'; s.style.transform=`translate(${dx}px,${dy}px) scale(${k})`; });
      void body.offsetWidth;
      all.forEach(s=>{ s.style.transition=''; s.classList.add('moving'); s.style.transform=''; });
      setTimeout(()=>{ all.forEach(s=>s.classList.remove('moving')); drawSeam(); }, 600);
    }
    function byRank(){ grid.hidden=false; areasEl.hidden=true; all.forEach(s=>grid.appendChild(s)); areasEl.innerHTML=''; tones(); }
    function byArea(){
      const names=Object.keys(AREAS);
      areasEl.innerHTML=''; grid.hidden=true; areasEl.hidden=false;
      names.forEach(n=>{ const sq=all.filter(s=>s.dataset.area===n); const done=sq.filter(s=>s.dataset.stage==='done').length;
        const row=document.createElement('div'); row.className='arow';
        row.innerHTML=`<span class="alabel"><i style="background:${AREAS[n].color}"></i>${AREAS[n].name}</span><span class="acells"></span><span class="acount">${done}/${sq.length}</span>`;
        const cells=row.querySelector('.acells'); sq.forEach(s=>cells.appendChild(s)); areasEl.appendChild(row); });
      tones();
    }
    cloth.querySelectorAll('.seg button').forEach(b=>b.addEventListener('click',()=>{
      cloth.querySelectorAll('.seg button').forEach(x=>x.classList.toggle('on',x===b));
      seam.innerHTML=''; cloth.querySelector('.cloth-title').textContent=b.dataset.mode==='area'?'The glaze, by area':'The glaze, rank 1 to '+R.TOTAL; flip(b.dataset.mode==='area'?byArea:byRank);
    }));
    function showTip(s){ const r=rc(s), b=rc(body);
      tip.innerHTML=`<span class="tn">#${s.dataset.n}</span>${s.dataset.feat}<span class="ts ${s.dataset.stage}">${stageLabel[s.dataset.stage]} · ${AREAS[s.dataset.area].name}</span>`;
      tip.hidden=false; let x=r.left-b.left+r.width/2-tip.offsetWidth/2, y=r.top-b.top-tip.offsetHeight-8;
      x=Math.max(0,Math.min(x,b.width-tip.offsetWidth)); if(y<0) y=r.bottom-b.top+8; tip.style.left=x+'px'; tip.style.top=y+'px'; }
    all.forEach(s=>{ s.addEventListener('mouseenter',()=>showTip(s)); s.addEventListener('focus',()=>showTip(s));
      s.addEventListener('mouseleave',()=>tip.hidden=true); s.addEventListener('blur',()=>tip.hidden=true);
      s.addEventListener('click',()=>{ window.parityShow && window.parityShow(+s.dataset.n); }); });
    tones();
    const ro=new ResizeObserver(()=>drawSeam()); ro.observe(body);
    setTimeout(drawSeam, 50);
  })();

  // the log
  (function(){
    let stage='all', area='';
    const list=document.getElementById('plist'); if(!list) return;
    const sel=document.getElementById('area-select');
    const svg=document.getElementById('loggraph');
    const keys=Object.keys(AREAS), LANE=11;
    document.getElementById('lanekeys').innerHTML=keys.map(k=>`<span><i style="background:${AREAS[k].color}"></i>${AREAS[k].name}</span>`).join('');
    function drawLog(){
      if(list.offsetWidth===0) return;
      const lb=rc(list);
      svg.setAttribute('viewBox',`0 0 ${lb.width} ${lb.height}`); svg.style.height=lb.height+'px';
      const sample=list.querySelector('.prow:not(.hide) .lanes'); if(!sample){ svg.innerHTML=''; return; }
      const lr=rc(sample); const x0=lr.left-lb.left+8;
      const laneX=k=>x0+keys.indexOf(k)*LANE;
      const cx=x0+((keys.length-1)*LANE)/2;
      const seamRow=document.getElementById('seamrow'); const hasSeam=seamRow&&seamRow.offsetParent!==null;
      let sy=0,sTop=0,sBot=0; if(hasSeam){ const r=rc(seamRow); sTop=r.top-lb.top; sBot=r.bottom-lb.top; sy=(sTop+sBot)/2; }
      const vis=[...list.querySelectorAll('.prow:not(.hide)')].map(r=>{ const b=rc(r); const y=b.top-lb.top+b.height/2; return {k:r.dataset.area,y,stage:r.dataset.stage,n:+r.dataset.n,above:hasSeam?y<sTop:true}; });
      let paths='',nodes='';
      keys.forEach(k=>{ const col=AREAS[k].color, x=laneX(k);
        const ab=vis.filter(v=>v.k===k&&v.above), be=vis.filter(v=>v.k===k&&!v.above);
        if(!hasSeam){ if(ab.length>1) paths+=`<path d="M${x} ${ab[0].y} V${ab[ab.length-1].y}" stroke="${col}"/>`; return; }
        if(ab.length){ const yA=sTop-4; paths+=`<path d="M${x} ${ab[0].y} V${yA} C${x} ${sy} ${cx} ${yA} ${cx} ${sy}" stroke="${col}"/>`; }
        if(be.length){ const yB=sBot+4; paths+=`<path d="M${cx} ${sy} C${cx} ${yB} ${x} ${sy} ${x} ${yB} V${be[be.length-1].y}" stroke="${col}"/>`; }
      });
      vis.forEach(v=>{ const x=laneX(v.k), col=AREAS[v.k].color;
        if(v.stage==='done') nodes+=`<circle cx="${x}" cy="${v.y}" r="4" fill="${col}"/>`;
        else if(v.stage==='v1') nodes+=`<circle cx="${x}" cy="${v.y}" r="3.6" fill="#1a1d24" stroke="${col}" stroke-width="1.7"/>`;
        else if(v.stage==='after') nodes+=`<circle cx="${x}" cy="${v.y}" r="3.6" fill="#1a1d24" stroke="${col}" stroke-width="1.4" stroke-dasharray="2 1.5"/>`;
        else nodes+=`<circle cx="${x}" cy="${v.y}" r="3.6" fill="#1a1d24" stroke="${col}" stroke-width="1.2" opacity=".55"/><path d="M${x-2.2} ${v.y-2.2}l4.4 4.4M${x+2.2} ${v.y-2.2}l-4.4 4.4" stroke="${col}" stroke-width="1.2" opacity=".8"/>`;
        if(NEXT.has(v.n)) nodes+=`<circle cx="${x}" cy="${v.y}" r="7" fill="none" stroke="#5fad65" stroke-width="1.6"/>`;
      });
      if(hasSeam) nodes+=`<circle cx="${cx}" cy="${sy}" r="8" fill="#e0b94f" stroke="#1a1d24" stroke-width="2.5"/><circle cx="${cx}" cy="${sy}" r="3" fill="#1a1d24"/>`;
      svg.innerHTML=`<g fill="none" stroke-width="2" stroke-linecap="round">${paths}</g><g>${nodes}</g>`;
    }
    window.drawLog=drawLog;
    function apply(){
      list.querySelectorAll('.prow').forEach(r=>{ const ok=(stage==='all'||r.dataset.stage===stage)&&(!area||r.dataset.area===area); r.classList.toggle('hide',!ok); });
      list.querySelectorAll('.tierhead').forEach(t=>{ let n=t.nextElementSibling, any=false;
        while(n&&!n.classList.contains('tierhead')){ if(n.classList.contains('prow')&&!n.classList.contains('hide')) any=true; n=n.nextElementSibling; }
        t.classList.toggle('hide',!any); });
      document.querySelectorAll('.fbtn').forEach(b=>b.classList.toggle('on',b.dataset.stage===stage));
    }
    function syncDetails(){ document.querySelectorAll('.pdetail').forEach(d=>{ const r=document.getElementById(d.dataset.for); const open=r&&r.classList.contains('open')&&!r.classList.contains('hide'); d.hidden=!open; if(r) r.setAttribute('aria-expanded',String(!!open)); }); requestAnimationFrame(drawLog); }
    document.querySelectorAll('.prow.expandable').forEach(r=>{ const toggle=e=>{ if(e.target.closest('a')) return; r.classList.toggle('open'); syncDetails(); };
      r.addEventListener('click',toggle); r.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggle(e); } }); });
    document.querySelectorAll('.fbtn').forEach(b=>b.addEventListener('click',()=>{ stage=b.dataset.stage; apply(); syncDetails(); }));
    sel.addEventListener('change',()=>{ area=sel.value; apply(); syncDetails(); });
    window.parityShow=function(n){ stage='all'; area=''; sel.value=''; apply(); syncDetails(); const row=document.getElementById('prow-'+n); if(!row) return;
      row.scrollIntoView({block:'center',behavior:'smooth'}); row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash'); };
    new ResizeObserver(()=>drawLog()).observe(list);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawLog);
    setTimeout(drawLog, 80);
  })();

  if (location.hash === '#nonav') { const h=document.getElementById('navhide'); h && h.click(); }
})();
