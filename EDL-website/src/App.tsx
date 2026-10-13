import { useEffect, useState } from 'react';
import { useMeasurements } from './hooks/useMeasurements';
import { MetricCard } from './components/MetricCard';
import { HistoryChart } from './components/HistoryChart';
import { SettingsPanel } from './components/SettingsPanel';
import { Analysis } from './components/Analysis';
import { metrics } from './types';
import './App.css';
const pages = [{path:'/',label:'測定'},{path:'/history',label:'履歴'},{path:'/analysis',label:'解析'},{path:'/setting',label:'設定'}];
export default function App() {
 const [path,setPath]=useState(window.location.pathname),[days,setDays]=useState(1),[view,setView]=useState('list');
 const {latest,records,interval,error,checkedAt}=useMeasurements(path === '/analysis' ? 1 : days);
 const stale=!latest || checkedAt-Date.parse(latest.received_at)>60000;
 useEffect(()=>{const change=()=>setPath(window.location.pathname);window.addEventListener('popstate',change);return ()=>window.removeEventListener('popstate',change);},[]);
 function navigate(next:string){window.history.pushState(null,'',next);setPath(next);window.scrollTo(0,0);}
 return <main className="dashboard">
 <header><a className="brand" href="/">EDL <span>環境モニター</span></a><span className="muted">UNO R4 WiFi</span></header>
 <nav aria-label="メインナビゲーション">{pages.map(page=><a key={page.path} href={page.path} aria-current={path===page.path?'page':undefined} onClick={e=>{if(!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&e.button===0){e.preventDefault();navigate(page.path);}}}>{page.label}</a>)}</nav>
 <h1>{pages.find(page=>page.path===path)?.label ?? 'ページが見つかりません'}</h1>
 {path!=='/setting'&&error&&<p className="notice" role="status">{error}</p>}
 {path==='/'&&<><section className="device-card"><div className="device-symbol" aria-hidden="true">∞</div><div><h2>Arduino</h2><p className="connection"><span className={`dot ${stale?'offline':''}`}/>{stale?'更新待ち':'接続中'}</p><p className="muted">{latest?`${latest.device_id} · ${new Date(latest.received_at).toLocaleString('ja-JP')} 受信`:'測定データなし'}</p></div></section><section className="metric-grid" aria-label="最新測定値">{metrics.map(metric=><MetricCard key={metric.key} metric={metric} value={latest?.[metric.key]??null} stale={stale}/>)}</section><p className="muted update-note">10秒ごとに更新</p></>}
 {path==='/history'&&<section className="history"><div className="section-heading"><div className="view-switch"><button className={view==='list'?'active':'quiet'} onClick={()=>setView('list')}>一覧</button><button className={view==='chart'?'active':'quiet'} onClick={()=>setView('chart')}>グラフ</button></div><select aria-label="履歴の表示期間" value={days} onChange={e=>setDays(Number(e.target.value))}><option value={1}>24時間</option><option value={3}>3日間</option><option value={7}>7日間</option></select></div><p className="muted">{interval}分ごとの平均値 · {records.length}件</p>{view==='chart'?metrics.map(metric=><HistoryChart key={metric.key} metric={metric} records={records}/>):records.length?<div className="table-scroll"><table><caption>測定履歴（新しい順）</caption><thead><tr><th scope="col">日時</th>{metrics.map(metric=><th scope="col" key={metric.key}>{metric.label}<small>{metric.unit}</small></th>)}<th scope="col">測定数</th></tr></thead><tbody>{[...records].reverse().map(row=><tr key={row.ended_at}><th scope="row">{new Date(row.ended_at).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</th>{metrics.map(metric=><td key={metric.key}>{row.metrics[metric.key].mean?.toFixed(metric.digits)??'—'}</td>)}<td>{row.samples}</td></tr>)}</tbody></table></div>:<p className="empty">履歴はまだありません</p>}</section>}
 {path==='/analysis'&&<Analysis latest={latest} stale={stale} records={records}/>}
 {path==='/setting'&&<SettingsPanel onSaved={()=>{}}/>}
 {!pages.some(page=>page.path===path)&&<a href="/">測定画面へ</a>}
 <footer>eCO₂は推定値、騒音は未校正の換算値。EDL評価はデモ用の目安。</footer>
 </main>;
}
