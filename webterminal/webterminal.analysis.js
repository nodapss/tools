(function(){
  function analyzeNow(){
    try {
      const chart = window.chart || (typeof getChart==='function' ? getChart() : null);
      const d0 = chart?.data?.datasets?.[0]?.data || [];
      const d1 = chart?.data?.datasets?.[1]?.data || [];
      const getStats = (arr)=>{
        const ys = arr.map(p=>p.y).filter(Number.isFinite);
        if (!ys.length) return {min: NaN, max: NaN, offset: NaN};
        const min = Math.min(...ys); const max = Math.max(...ys);
        const offset = (min + max) / 2;
        return {min, max, offset};
      };
      const s1 = getStats(d0), s2 = getStats(d1);
      const set = (id,v)=>{ const el=document.getElementById(id); if (el) el.value = Number.isFinite(v) ? v.toFixed(3) : ''; };
      set('anCh1Max', s1.max); set('anCh1Min', s1.min); set('anCh1Offset', s1.offset);
      set('anCh2Max', s2.max); set('anCh2Min', s2.min); set('anCh2Offset', s2.offset);
    } catch (e) { try { console.error('[analysis] error', e); } catch(_) {} }
  }

  window.addEventListener('webterm:chart-updated', analyzeNow);
  const btn = document.getElementById('btnAnalyze');
  if (btn) btn.addEventListener('click', analyzeNow);
})();
