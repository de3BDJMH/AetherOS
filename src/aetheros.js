// ==UserScript==
// @name         Aether 多角色同屏
// @namespace    mugen.aether.multiview
// @version      0.29.0
// @description  官网多角色桌面、背包筛选与数据云同步、跨角色物品查找、强化预测及手动启动的连续用券。
// @match        https://game.diving-fish.com/aether/*
// @run-at       document-start
// @sandbox      raw
// @inject-into  page
// @updateURL    https://raw.githubusercontent.com/de3BDJMH/AetherOS/main/AetherOS.meta.js
// @downloadURL  https://raw.githubusercontent.com/de3BDJMH/AetherOS/main/AetherOS.user.js
// @homepageURL  https://github.com/de3BDJMH/AetherOS
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
  if(location.origin!=='https://game.diving-fish.com'||!location.pathname.startsWith('/aether/'))return;
  const SCRIPT_VERSION='__AETHEROS_VERSION__';
  const ACTIVE='aether_active_character',CONFIG='aether-multiview-layout-v1',PREFIX='aether-multiview:',CHANNEL='aether-multiview-state',ORIGIN=location.origin;
  const ready=fn=>document.readyState==='loading'?document.addEventListener('DOMContentLoaded',fn,{once:true}):fn();
  const element=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  const button=(text,fn)=>{const node=element('button',text);node.type='button';node.addEventListener('click',fn);return node;};
  const GEAR_SLOTS={weapon:['武器','mdi-sword'],top:['上装','mdi-tshirt-crew'],bottom:['下装','mdi-underwear-outline'],gloves:['手部','mdi-boxing-glove'],shoes:['鞋部','mdi-shoe-sneaker'],accessory:['饰品','mdi-necklace'],none:['未标注','mdi-help-circle-outline']};
  const equipmentSlot=item=>Object.hasOwn(GEAR_SLOTS,item?.slot)&&item.slot!=='none'?item.slot:'none';
  function notifyPinChange(character,uuid,pinned){try{window.top.dispatchEvent(new window.top.CustomEvent('aether-pin-change',{detail:{character,uuid,pinned}}));}catch{}}
  function reinforceProgressFromStatus(character,data){
    if(!Array.isArray(data?.backpack?.equipment)||!Array.isArray(data?.equipment_slots))throw new Error('官网装备数据结构无效，本角色未导入');
    const items=new Map();let skipped=0;
    const add=(item,slot)=>{if(!item||typeof item!=='object')return;if(typeof item.uuid!=='string'||!item.uuid||item.uuid.length>128){skipped++;return;}items.set(item.uuid,{...items.get(item.uuid),...item,...(slot?{slot}:{})});};
    data.backpack.equipment.forEach(item=>add(item));data.equipment_slots.forEach(row=>{if(row?.item)add(row.item,row.slot);});const records=[];
    for(const item of items.values()){
      const level=item.reinforce_level,fails=item.reinforce_fails;if(!Number.isInteger(level)||level<0||level>15||!Number.isSafeInteger(fails)||fails<0||fails>1000000){skipped++;continue;}if(level===0&&fails===0)continue;
      records.push({character,uuid:item.uuid,info:{equipment:{name:typeof item.name==='string'?item.name.slice(0,200):'',item_id:typeof item.item_id==='string'?item.item_id.slice(0,128):'',slot:typeof item.slot==='string'?item.slot.slice(0,30):'',rarity:Number.isInteger(item.rarity)&&item.rarity>=0&&item.rarity<=10?item.rarity:0,reinforce_level:level},maxed:level===15,next:level<15?{fails}:null}});
    }
    return {records,skipped};
  }
  function inventorySnapshot(character,name,status,capturedAt=Date.now(),readId=crypto.randomUUID()){
    const bag=status?.backpack;if(!bag||!['equipment','materials','consumables'].every(key=>Array.isArray(bag[key]))||!Array.isArray(status.equipment_slots))throw Error('背包数据不完整，原库存缓存保留');
    const gear=new Map(),groups=new Map(),seen=new Set(),slots=new Set(['weapon','top','bottom','gloves','shoes','accessory']),elementKeys=new Set(['fire','water','lightning','earth','wind','light','dark']),skills=new Map();
    for(const slot of Object.values(status.skills?.available||{}))for(const row of slot?.options||[])if(typeof row?.skill_code==='string')skills.set(row.skill_code,row);
    function related(item,kind){if(Object.hasOwn(item,'elements')){if(!Array.isArray(item.elements)||item.elements.some(key=>!elementKeys.has(key)))throw Error('物品元素数据无效');return [...new Set(item.elements)].sort();}const found=new Set(),add=value=>{if(elementKeys.has(value))found.add(value);},positive=value=>{for(const [key,n]of Object.entries(value||{}))if(typeof n==='number'&&Number.isFinite(n)&&n>0)add(key);},requirements=value=>{if(Array.isArray(value)){for(const row of value)if(typeof row?.key==='string'&&row.key.startsWith('affinities.')&&typeof row.required==='number'&&row.required>0)add(row.key.slice(11));}else if(value&&typeof value==='object')positive(value.affinities||value);};add(item.element);if(kind==='equipment'){for(const [key,n]of Object.entries(item.element_coeffs||{}))if(typeof n==='number'&&n>1)add(key);positive(item.element_coeff_levels);positive(item.affinity_bonus);for(const stats of [item.base_stats,item.override_stats,item.effective_stats])for(const [key,n]of Object.entries(stats||{}))if(key.startsWith('amplify_')&&typeof n==='number'&&n>0)add(key.slice(8));}else if(kind==='skill'){const info=skills.get(item.skill_grant);add(item.skill?.damage_type);add(info?.skill?.damage_type);requirements(info?.requirement);requirements(item.requirement);}else if(!(kind==='prism'&&Object.hasOwn(item,'element')&&item.element===null))requirements(item.requirement);return [...found].sort();}
    for(const item of bag.equipment){if(typeof item?.uuid!=='string'||!item.uuid)throw Error('装备标识无效');gear.set(item.uuid,{item,equipped:0});}
    for(const row of status.equipment_slots){if(!row||typeof row!=='object')throw Error('穿戴数据无效');if(row.item==null)continue;const item=row.item;if(typeof item.uuid!=='string'||!item.uuid)throw Error('穿戴装备标识无效');gear.set(item.uuid,{item:{...item,slot:item.slot||row.slot},equipped:1});}
    function add(item,kind,equipped=0){
      if(!item||typeof item!=='object')throw Error('物品数据无效');const id=item.item_id||item.id||'',name=item.name||id;
      if(typeof id!=='string'||id.length>200||typeof name!=='string'||!name||name.length>300)throw Error('物品名称无效');
      const count=kind==='equipment'?1:item.count;if(!Number.isSafeInteger(count)||count<0)throw Error('物品数量无效');if(!count)return;
      const rarity=Number.isInteger(item.rarity)&&item.rarity>=0&&item.rarity<=6?item.rarity:0,slot=kind==='equipment'&&slots.has(item.slot)?item.slot:'',elements=related(item,kind),key=JSON.stringify([kind,id,name,rarity,slot,elements]);
      const row=groups.get(key)||{key,item_id:id,name,kind,rarity,slot,elements,count:0,equipped:0};row.count+=count;row.equipped+=equipped;if(!Number.isSafeInteger(row.count))throw Error('物品总数无效');groups.set(key,row);
    }
    for(const row of gear.values())add(row.item,'equipment',row.equipped);
    for(const bucket of ['materials','consumables'])for(const item of bag[bucket]){
      if(!item||typeof item!=='object')throw Error('物品数据无效');if(item.uuid){const key=bucket+':'+item.uuid;if(seen.has(key))throw Error('物品标识重复，原库存缓存保留');seen.add(key);}
      let kind=bucket==='materials'?'material':'other';if(bucket==='consumables'){if(item.effect_type==='skill_grant'||String(item.name||'').includes('技能书'))kind='skill';else if(item.effect_type==='prism_talent'||String(item.item_id||'').startsWith('prism_'))kind='prism';}add(item,kind);
    }
    if(groups.size>15000)throw Error('库存分组过多，原缓存保留');return {version:2,character,name:name||character,captured_at:capturedAt,read_id:readId,items:[...groups.values()].sort((a,b)=>a.key<b.key?-1:1)};
  }
  function validInventorySnapshot(row){
    return [1,2].includes(row?.version)&&typeof row.character==='string'&&row.character.trim()&&row.character.length<=100&&typeof row.name==='string'&&row.name.length>0&&row.name.length<=100&&Number.isSafeInteger(row.captured_at)&&row.captured_at>=0&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.read_id)&&Array.isArray(row.items)&&row.items.length<=15000&&new Set(row.items.map(item=>item?.key)).size===row.items.length&&row.items.every(item=>typeof item?.item_id==='string'&&item.item_id.length<=200&&typeof item.name==='string'&&item.name.length>0&&item.name.length<=300&&['equipment','skill','prism','material','other'].includes(item.kind)&&Number.isInteger(item.rarity)&&item.rarity>=0&&item.rarity<=6&&['','weapon','top','bottom','gloves','shoes','accessory'].includes(item.slot)&&Number.isSafeInteger(item.count)&&item.count>0&&Number.isSafeInteger(item.equipped)&&item.equipped>=0&&item.equipped<=item.count&&(item.kind==='equipment'||item.equipped===0)&&(item.elements==null?row.version===1:Array.isArray(item.elements)&&item.elements.length<=7&&item.elements.every(key=>['fire','water','lightning','earth','wind','light','dark'].includes(key))&&JSON.stringify(item.elements)===JSON.stringify([...new Set(item.elements)].sort()))&&item.key===JSON.stringify([item.kind,item.item_id,item.name,item.rarity,item.slot,...(item.elements==null?[]:[item.elements])]));
  }
  function initInventorySearch(){
    if(window.top!==window||window[Symbol.for('aether.inventory.search')])return;window[Symbol.for('aether.inventory.search')]=true;
    const PREFIX='aether-inventory-cache-v1:',SYNC='aether-inventory-sync-v1',labels={equipment:'装备',skill:'技能书',prism:'光谱',material:'材料',other:'其他'},rarities={1:'#9ea3b0',2:'#6ddc8e',3:'#5db8ff',4:'#c47aff',5:'#ffc84a',6:'#ff5b5b'};
    const selectedStars=new Set(),selectedElements=new Set(),selectedSlots=new Set(),elementInfo={fire:['火','mdi-fire','#ff7a5c'],water:['水','mdi-water','#62d1ff'],lightning:['雷','mdi-lightning-bolt','#ffd451'],earth:['地','mdi-terrain','#9bd36e'],wind:['风','mdi-weather-windy','#6eeedc'],light:['光','mdi-white-balance-sunny','#f9ffb5'],dark:['暗','mdi-moon-waning-crescent','#a98bff'],none:['未标注','mdi-circle-outline','#a3acbb']};
    let filterTools,slotTools,advancedSummary,legacyMessage;
    let modal,card,query,kind,who,list,feedback,summary,cacheInfo,manage,currentButton,allButton,stopButton,syncButton,previous,next,pageLabel,syncMessage,returnFocus,run=null,character='',cache=[],groups=[],page=0,timer=null,syncing=false,again=false;
    const normal=value=>String(value).normalize('NFKC').toLocaleLowerCase(),compare=(a,b)=>a.captured_at-b.captured_at||a.read_id.localeCompare(b.read_id),open=()=>modal&&!modal.hidden;
    const cachedRole=()=>{try{return sessionStorage.getItem(ACTIVE)||localStorage.getItem(ACTIVE)||'';}catch{return '';}};
    const n=(tag,text,cls)=>element(tag,text,cls),date=value=>new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
    function label(row){let note='';try{note=readRolePreferences().notes.get(row.character)||'';}catch{}return (row.name&&row.name!==row.character?row.name+' · ':'')+row.character+(note?' ('+note+')':'');}
    function load(){cache=[];let invalid=0;try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith(PREFIX))continue;try{const row=JSON.parse(localStorage.getItem(key));if(!validInventorySnapshot(row)||key!==PREFIX+row.character)throw Error();cache.push(row);}catch{invalid++;}}}catch{invalid++;}
      const map=new Map();for(const snapshot of cache)for(const item of snapshot.items){const group=map.get(item.key)||{...item,count:0,holders:[],search:normal(item.name+' '+labels[item.kind])};group.count+=item.count;group.holders.push({character:snapshot.character,name:snapshot.name,count:item.count,equipped:item.equipped,captured_at:snapshot.captured_at});map.set(item.key,group);}groups=[...map.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')||a.key.localeCompare(b.key));
      if(open()){const selected=who.value;who.replaceChildren(new Option('全部缓存角色',''),...cache.map(row=>new Option(label(row),row.character)));who.value=cache.some(row=>row.character===selected)?selected:'';cacheInfo.replaceChildren(n('summary','已缓存 '+cache.length+' 个角色 · 查看读取时间'));for(const row of cache){const line=n('div',undefined,'amv-inventory-cache-row');line.append(n('span',label(row)),n('small',date(row.captured_at)));cacheInfo.append(line);}if(invalid&&!run)feedback.textContent='有 '+invalid+' 份缓存无法读取，可重新读取库存恢复。';render();}
    }
    function put(row){if(!validInventorySnapshot(row))throw Error('库存缓存格式无效');let old;try{old=JSON.parse(localStorage.getItem(PREFIX+row.character)||'null');}catch{}if(validInventorySnapshot(old)&&old.captured_at<=Date.now()+300000&&compare(old,row)>=0)return old;try{localStorage.setItem(PREFIX+row.character,JSON.stringify(row));}catch{throw Error('本机缓存空间不足，原缓存保留');}return row;}
    function render(){if(!open())return;const words=normal(query.value.trim()).split(/\s+/).filter(Boolean),browse=words.length||kind.value||who.value||selectedStars.size||selectedElements.size||selectedSlots.size;list.replaceChildren();advancedSummary.textContent='星级 · 元素 · 部位'+(selectedStars.size+selectedElements.size+selectedSlots.size?'（已选 '+(selectedStars.size+selectedElements.size+selectedSlots.size)+' 项）':'');legacyMessage.textContent=cache.some(row=>row.version===1)?'部分旧库存未保存元素信息，重新读取对应角色后即可按元素筛选。':'';if(!browse){summary.textContent=cache.length?'输入名称查找，或选择分类浏览缓存。':'尚无库存缓存，请手动读取角色。';previous.disabled=next.disabled=true;pageLabel.textContent='';return;}
      const results=[];for(const group of groups){if(selectedStars.size&&!selectedStars.has(group.rarity)||selectedSlots.size&&!selectedSlots.has(group.slot)||selectedElements.size&&(group.elements==null||![...selectedElements].some(key=>key==='none'?!group.elements.length:group.elements.includes(key))))continue;if(kind.value&&kind.value!==group.kind||!words.every(word=>group.search.includes(word)))continue;const holders=group.holders.filter(row=>!who.value||row.character===who.value);if(holders.length)results.push({...group,holders,count:holders.reduce((sum,row)=>sum+row.count,0)});}
      const pages=Math.max(1,Math.ceil(results.length/20));page=Math.max(0,Math.min(page,pages-1));summary.textContent='找到 '+results.length+' 种物品 · 数量来自已读取的缓存';previous.disabled=page===0;next.disabled=page+1>=pages;pageLabel.textContent=results.length?(page+1)+' / '+pages:'';
      for(const group of results.slice(page*20,page*20+20)){const result=n('article',undefined,'amv-inventory-item'),head=n('header'),icon=n('i',undefined,'mdi '+(group.kind==='equipment'?(GEAR_SLOTS[group.slot]?.[1]||'mdi-sword'):group.kind==='skill'?'mdi-book-open-variant':group.kind==='prism'?'mdi-triangle-outline':group.kind==='material'?'mdi-cube-outline':'mdi-flask-outline')),title=n('strong',group.name),amount=n('b','×'+group.count.toLocaleString());result.style.setProperty('--inventory-color',rarities[group.rarity]||'#b5d7e8');head.append(icon,title,amount);const meta=n('small',labels[group.kind]+(group.rarity?' · '+'★'.repeat(group.rarity):''));result.append(head,meta);
        for(const row of group.holders){const line=n('div',undefined,'amv-inventory-holder'),name=n('span',label(row)),counts=n('span','×'+row.count.toLocaleString()+(row.equipped?' · 穿戴 '+row.equipped:'')),time=n('small',date(row.captured_at));line.append(name,counts,time);result.append(line);}list.append(result);}
      if(!results.length)list.append(n('p','缓存中没有找到；尚未读取或读取失败的角色不在统计中。','amv-inventory-empty'));
    }
    async function get(path,who,active){const at=Date.now(),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);active.controller=controller;try{const url=new URL('/api/aether'+path,ORIGIN);if(who)url.searchParams.set('_aether_character',who);const response=await fetch(url,{credentials:'same-origin',cache:'no-store',headers:who?{'X-Aether-Character':who}:{},signal:controller.signal}),value=await response.json().catch(()=>null);if(!response.ok||value?.code!==0){const error=Error(response.status===401?'官网登录已失效':response.status===429?'请求过于频繁，请稍后读取':value?.message||'读取失败：HTTP '+response.status);error.stop=[401,403,429].includes(response.status)||[401,403,429].includes(value?.code);throw error;}return {data:value.data,at};}finally{clearTimeout(timeout);if(active.controller===controller)active.controller=null;}}
    function stop(){if(run){run.cancelled=true;run.controller?.abort();stopButton.disabled=true;feedback.textContent='正在停止读取，已有缓存保留。';}}
    async function read(all){if(run)return;const active={cancelled:false,controller:null};run=active;currentButton.disabled=allButton.disabled=true;stopButton.hidden=false;stopButton.disabled=false;let total=0,updated=0,processed=0;const errors=[];
      try{const execute=async()=>{let roles;if(all){feedback.textContent='正在读取自有角色列表…';const reply=await get('/account',null,active);if(!Array.isArray(reply.data?.characters))throw Error('角色列表无效');const names=new Map();for(const row of reply.data.characters){if(typeof row?.username!=='string'||!row.username.trim()||row.username.length>100)throw Error('角色列表无效');if(row.type!=='offline_friend')names.set(row.username,{username:row.username,name:String(row.name||row.username).slice(0,100)});}roles=[...names.values()];if(roles.length>100)throw Error('角色列表数量异常');}else{const role=character||cachedRole();if(!role)throw Error('请先在官网选择角色');roles=[{username:role,name:cache.find(row=>row.character===role)?.name||role}];}total=roles.length;
        for(const row of roles){if(active.cancelled)break;feedback.textContent='正在读取 '+row.username+' · '+(processed+1)+' / '+total;try{const reply=await get('/status',row.username,active);if(active.cancelled)break;put(inventorySnapshot(row.username,String(reply.data?.character?.name||row.name).slice(0,100),reply.data,reply.at));updated++;load();}catch(error){if(active.cancelled)break;errors.push(row.username+'：'+(error.name==='AbortError'?'读取超时':error.message));if(error.stop||error instanceof TypeError)break;}processed++;if(processed<total&&!active.cancelled)await new Promise(resolve=>setTimeout(resolve,300));}
      };if(navigator.locks?.request)await navigator.locks.request('aether-inventory-read',{ifAvailable:true},async lock=>{if(!lock)throw Error('另一个窗口正在读取库存');await execute();});else await execute();
      }catch(error){if(!active.cancelled)errors.push(error.message);}finally{run=null;currentButton.disabled=allButton.disabled=false;stopButton.hidden=true;feedback.textContent=(active.cancelled?'已停止':'读取结束')+' · 已更新 '+updated+' / '+total+' 个角色'+(errors.length?'；'+errors.join('；'):'')+'。未更新的角色保留原缓存。';load();if(updated)synchronize();}
    }
    function config(){try{const value=JSON.parse(localStorage.getItem('aether-pin-sync-v1')||'null'),url=new URL(value.server);return value.version===1&&value.initial===null&&url.origin===value.server&&(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname))&&/^[A-Za-z0-9_-]{32,128}$/.test(value.token)&&/^[A-Za-z0-9_-]{20,80}$/.test(value.client_id)?value:null;}catch{return null;}}
    function inventoryStatus(message){window[Symbol.for('aether.inventory.sync.status')]={message};window.dispatchEvent(new CustomEvent('aether-inventory-sync-status',{detail:{message}}));if(open())syncMessage.textContent=message;}
    async function synchronize(){if(syncing){again=true;return;}const connection=config();if(!connection){inventoryStatus('库存仅保存在本机；连接数据同步后可与 Web 共用。');return;}syncing=true;if(open())syncButton.disabled=true;inventoryStatus('正在同步已有库存缓存…');
      try{const execute=async()=>{let progress;try{progress=JSON.parse(localStorage.getItem(SYNC)||'null');}catch{}if(progress?.server!==connection.server||progress?.client_id!==connection.client_id)progress={server:connection.server,client_id:connection.client_id,cursor:0,sent:{}};
        for(let round=0;round<300;round++){const current=config();if(current?.server!==connection.server||current.token!==connection.token||current.client_id!==connection.client_id)return;load();const pending=cache.find(row=>progress.sent[row.character]!==row.read_id),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);let response,data;try{response=await fetch(connection.server+'/api/aetheros/inventory/sync',{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',headers:{'Content-Type':'application/json','Authorization':'Bearer '+connection.token},body:JSON.stringify({client_id:connection.client_id,cursor:progress.cursor,snapshots:pending?[pending]:[]}),signal:controller.signal});data=await response.json().catch(()=>null);}finally{clearTimeout(timer);}
          if(!response.ok)throw Error(response.status===404?'Web 尚未更新，库存缓存保留在本机':typeof data?.detail==='string'?data.detail:'库存缓存同步失败');if(data?.version!==1||!Number.isSafeInteger(data.cursor)||data.cursor<0||!Array.isArray(data.accepted)||data.accepted.length>1||!Array.isArray(data.snapshots)||data.snapshots.length>1||typeof data.has_more!=='boolean'||![...data.accepted,...data.snapshots].every(validInventorySnapshot))throw Error('库存同步响应无效');
          const active=config();if(active?.server!==connection.server||active?.token!==connection.token||active?.client_id!==connection.client_id)return;if(data.accepted.length!==(pending?1:0)||pending&&data.accepted[0]?.character!==pending.character)throw Error('库存同步确认无效');for(const row of [...data.accepted,...data.snapshots]){put(row);progress.sent[row.character]=row.read_id;}progress.cursor=data.cursor;localStorage.setItem(SYNC,JSON.stringify(progress));load();if(!data.has_more&&!cache.some(row=>progress.sent[row.character]!==row.read_id)){inventoryStatus('库存缓存已同步到 Web');return;}
        }throw Error('库存缓存较多，请再次点击同步继续');};if(navigator.locks?.request)await navigator.locks.request('aether-inventory-sync',execute);else await execute();
      }catch(error){inventoryStatus((error.name==='AbortError'?'库存同步超时':error.message)+'，本机记录保留。');}finally{syncing=false;if(open())syncButton.disabled=false;if(again){again=false;synchronize();}}
    }
      function build(){if(modal)return;const style=n('style');style.textContent=`
        .amv-inventory-modal[hidden]{display:none!important}.amv-inventory-modal{position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;padding:24px;background:#030817a8;color:#e6edf9;font:14px/1.6 system-ui}.amv-inventory-card{width:min(1040px,100%);max-height:calc(100dvh - 48px);overflow:auto;box-sizing:border-box;background:#101b2e;border:1px solid #7890ae45;border-radius:16px;padding:24px;box-shadow:0 16px 70px #0005}.amv-inventory-card *{box-sizing:border-box}.amv-inventory-card header{display:flex;align-items:center;gap:10px}.amv-inventory-title{margin-bottom:20px}.amv-inventory-title h2{margin:0;flex:1;font-size:19px;font-weight:600}.amv-inventory-title>i{color:#83d5ca;font-size:22px}.amv-inventory-card button,.amv-inventory-card input,.amv-inventory-card select{font:inherit;color:inherit;background:#18273d;border:1px solid #7890ae38;border-radius:7px;padding:7px 11px;margin:0}.amv-inventory-card button{cursor:pointer}.amv-inventory-card button:hover{border-color:#83d5ca80}.amv-inventory-card button:focus-visible,.amv-inventory-card input:focus-visible,.amv-inventory-card select:focus-visible,.amv-inventory-card summary:focus-visible{outline:2px solid #83d5ca;outline-offset:2px}.amv-inventory-card button:disabled{opacity:.4;cursor:default}.amv-inventory-card .amv-inventory-close{width:32px;height:32px;display:grid;place-items:center;padding:0;background:transparent;border-color:transparent;color:#a5b6ce;font-size:23px;line-height:1}.amv-inventory-filters{display:flex;gap:10px;margin-bottom:12px}.amv-inventory-filters input{flex:1;min-width:0;padding:11px 13px;font-size:15px;background:#0c1526}.amv-inventory-filters select{flex:0 1 240px;min-width:0;max-width:100%;font-size:12px}.amv-inventory-kinds{display:flex;flex-wrap:wrap;gap:6px}.amv-inventory-kinds button{background:transparent;border-color:transparent;color:#a8b9cf;padding:5px 12px;font-size:12px}.amv-inventory-kinds button[aria-pressed=true]{background:#73ccbd15;color:#a5e4d7;border-color:#73ccbd4a}.amv-inventory-advanced{margin-top:12px;color:#a9bfd5;font-size:12px}.amv-inventory-advanced>summary{cursor:pointer;padding:4px 0}.amv-inventory-filter-row{display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-top:9px}.amv-inventory-filter-row>span{width:30px;flex:none;color:#879cb7;font-size:11px}.amv-inventory-filter-row button{display:inline-flex;gap:4px;align-items:center;padding:4px 8px;color:var(--filter-color,#b0c2d9);font-size:11px;background:transparent}.amv-inventory-filter-row button[aria-pressed=true]{background:#ffffff0c;border-color:var(--filter-color,#9bccd5)}.amv-inventory-advanced>[data-inventory-clear]{font-size:11px;margin-top:10px;padding:4px 8px}.amv-inventory-legacy{color:#cdbf96;font-size:11px;margin:7px 0}.amv-inventory-legacy:empty{display:none}.amv-inventory-management{margin:15px 0 18px;font-size:12px;color:#a5b6cb}.amv-inventory-management>summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:7px;width:fit-content;padding:4px 0}.amv-inventory-management>summary::-webkit-details-marker{display:none}.amv-inventory-management>summary:after{content:'⌄';font-size:14px;color:#8197b3}.amv-inventory-management[open]>summary:after{transform:rotate(180deg)}.amv-inventory-management[open]{padding-bottom:13px;border-bottom:1px solid #7890ae26}.amv-inventory-actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.amv-inventory-actions button{font-size:12px}.amv-inventory-help{margin:9px 0;color:#8499b4;font-size:11px}.amv-inventory-cache-row{display:flex;justify-content:space-between;gap:12px;padding:3px 0;font-size:11px}.amv-inventory-summary{margin:12px 0 9px;color:#b3c2d7;font-size:12px}.amv-inventory-feedback{margin:10px 0;color:#c8d9e6;font-size:12px}.amv-inventory-feedback:empty{display:none}.amv-inventory-sync{margin:10px 0 0;color:#869cb6;font-size:11px}.amv-inventory-results{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:12px}.amv-inventory-item{min-width:0;border:1px solid #7890ae30;border-radius:10px;background:#132138;padding:15px}.amv-inventory-results:has(>.amv-inventory-item:only-child){grid-template-columns:minmax(0,1fr)}.amv-inventory-item header{padding-bottom:10px;border-bottom:1px solid #7890ae26}.amv-inventory-item header strong{min-width:0;flex:1;overflow-wrap:anywhere;font-size:14px;font-weight:550;color:var(--inventory-color)}.amv-inventory-item header i{color:var(--inventory-color);font-size:18px}.amv-inventory-item header b{color:#eef4ff;font-size:15px;font-weight:550;white-space:nowrap}.amv-inventory-item>small{display:block;margin:7px 0 4px;color:var(--inventory-color);font-size:10px;opacity:.85}.amv-inventory-holder{display:grid;grid-template-columns:minmax(0,1fr) auto 6.5rem;gap:8px 12px;padding:7px 0;font-size:12px;border-bottom:1px solid #7890ae16}.amv-inventory-holder:last-child{border:0;padding-bottom:0}.amv-inventory-holder>span:first-child{overflow-wrap:anywhere;color:#bdcde2}.amv-inventory-holder>span:nth-child(2){font-variant-numeric:tabular-nums;white-space:nowrap;color:#e2ecfa}.amv-inventory-holder>small{color:#7d93af;font-size:10px;text-align:right;align-self:center}.amv-inventory-card footer{display:flex;justify-content:center;align-items:center;gap:14px;margin-top:18px;color:#9fb1ca;font-size:12px}.amv-inventory-card footer button{font-size:12px}.amv-inventory-empty{grid-column:1/-1;margin:12px 0 25px;color:#8fa6c1;font-size:13px}@media(max-width:800px){.amv-inventory-results{grid-template-columns:minmax(0,1fr)}}@media(max-width:520px){.amv-inventory-modal{padding:10px}.amv-inventory-card{padding:18px;max-height:calc(100dvh - 20px);border-radius:12px}.amv-inventory-title{margin-bottom:15px}.amv-inventory-title h2{font-size:17px}.amv-inventory-filters{flex-wrap:wrap;gap:8px}.amv-inventory-filters input{flex-basis:100%}.amv-inventory-filters select{flex:1;padding:8px 11px}.amv-inventory-kinds{gap:3px}.amv-inventory-kinds button{padding:5px 9px}.amv-inventory-item{padding:12px}.amv-inventory-holder{grid-template-columns:minmax(0,1fr) auto;gap:1px 10px}.amv-inventory-holder>small{grid-column:1/-1;text-align:left}.amv-inventory-cache-row{flex-wrap:wrap}}
      `;document.head.append(style);
        modal=n('section',undefined,'amv-inventory-modal');modal.hidden=true;modal.dataset.amvInventoryDialog='';card=n('section',undefined,'amv-inventory-card');card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');card.setAttribute('aria-label','跨角色物品查找');const head=n('header',undefined,'amv-inventory-title'),glyph=n('i',undefined,'mdi mdi-magnify'),closeButton=button('×',close);glyph.setAttribute('aria-hidden','true');closeButton.className='amv-inventory-close';closeButton.setAttribute('aria-label','关闭');head.append(glyph,n('h2','物品查找'),closeButton);
        const filters=n('div',undefined,'amv-inventory-filters');query=n('input');query.type='search';query.maxLength=200;query.placeholder='输入物品名称…';query.setAttribute('aria-label','物品名称');who=n('select');who.setAttribute('aria-label','库存角色');filters.append(query,who);const choices=n('div',undefined,'amv-inventory-kinds');kind=n('input');kind.type='hidden';kind.value='';for(const [value,title]of [['','全部'],...Object.entries(labels)]){const choice=button(title,()=>{kind.value=value;slotTools.hidden=!['','equipment'].includes(value);if(slotTools.hidden){selectedSlots.clear();for(const choice of slotTools.querySelectorAll('button'))choice.setAttribute('aria-pressed','false');}for(const item of choices.children)item.setAttribute('aria-pressed',String(item===choice));page=0;render();});choice.dataset.inventoryKind=value;choice.setAttribute('aria-pressed',String(value===''));choices.append(choice);}
        filterTools=n('details',undefined,'amv-inventory-advanced');advancedSummary=n('summary','星级 · 元素 · 部位');filterTools.append(advancedSummary);const row=(label,values,set,attr)=>{const line=n('div',undefined,'amv-inventory-filter-row');line.append(n('span',label));for(const [key,title,icon,color]of values){const choice=button('',()=>{set.has(key)?set.delete(key):set.add(key);choice.setAttribute('aria-pressed',String(set.has(key)));page=0;render();});choice.dataset[attr]=key;choice.setAttribute('aria-pressed','false');if(color)choice.style.setProperty('--filter-color',color);if(icon){const glyph=n('i',undefined,'mdi '+icon);glyph.setAttribute('aria-hidden','true');choice.append(glyph);}choice.append(n('span',title));line.append(choice);}filterTools.append(line);return line;};row('星级',[1,2,3,4,5,6].map(value=>[value,value+'★','',rarities[value]]),selectedStars,'inventoryStar');row('元素',Object.entries(elementInfo).map(([key,[name,icon,color]])=>[key,name,icon,color]),selectedElements,'inventoryElement');slotTools=row('部位',Object.entries(GEAR_SLOTS).filter(([key])=>key!=='none').map(([key,[name,icon]])=>[key,name,icon]),selectedSlots,'inventorySlot');const clear=button('清空筛选',()=>{selectedStars.clear();selectedElements.clear();selectedSlots.clear();for(const choice of filterTools.querySelectorAll('[aria-pressed]'))choice.setAttribute('aria-pressed','false');page=0;render();});clear.dataset.inventoryClear='';filterTools.append(clear);legacyMessage=n('p','','amv-inventory-legacy');
        manage=n('details',undefined,'amv-inventory-management');manage.dataset.inventoryManagement='';manage.append(n('summary','库存与同步'));const actions=n('div',undefined,'amv-inventory-actions');currentButton=button('读取当前角色',()=>read(false));allButton=button('读取全部角色',()=>read(true));stopButton=button('停止读取',stop);syncButton=button('同步缓存',synchronize);stopButton.hidden=true;currentButton.dataset.inventoryReadCurrent='';allButton.dataset.inventoryReadAll='';stopButton.dataset.inventoryStop='';actions.append(currentButton,allButton,stopButton,syncButton);cacheInfo=n('details');manage.append(actions,n('p','手动读取，包含穿戴装备；使用现有设备码同步到 Web。消耗物品后需重新读取。','amv-inventory-help'),cacheInfo);
        feedback=n('p','','amv-inventory-feedback');feedback.setAttribute('role','status');syncMessage=n('p','','amv-inventory-sync');summary=n('p','','amv-inventory-summary');list=n('div',undefined,'amv-inventory-results');list.dataset.inventoryResults='';const pages=n('footer');previous=button('上一页',()=>{page--;render();});next=button('下一页',()=>{page++;render();});pageLabel=n('span');pages.append(previous,pageLabel,next);card.append(head,filters,choices,filterTools,legacyMessage,manage,feedback,summary,list,pages,syncMessage);modal.append(card);document.body.append(modal);
        query.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{page=0;render();},120);});who.addEventListener('change',()=>{page=0;render();});modal.addEventListener('click',event=>{if(event.target===modal)close();});modal.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();close();}if(event.key==='Tab'){const controls=[...card.querySelectorAll('button:not(:disabled),input:not([type=hidden]),select,summary')].filter(node=>node.getClientRects().length),first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
      }
    function close(){stop();if(modal)modal.hidden=true;returnFocus?.focus?.();}
    window.addEventListener('aether-inventory-search',event=>{build();returnFocus=document.activeElement;character=typeof event.detail?.character==='string'?event.detail.character:cachedRole();modal.hidden=false;currentButton.textContent='读取当前角色'+(character?' · '+character:'');feedback.textContent='';load();manage.open=!cache.length;query.focus();synchronize();});
    window.addEventListener('aether-inventory-sync-now',synchronize);window.addEventListener('storage',event=>{if(open()&&(event.key?.startsWith(PREFIX)||event.key===ROLE_PREFERENCES_KEY)){load();}});window.addEventListener('aether-role-preferences-change',()=>{if(open())render();});
  }

  function equipmentHoverComparison(item,equipped){
    const boosted=new Set(['max_hp','atk','spe','crit_rate','armor']),rounded=new Set(['max_hp','spe','armor']),finite=value=>typeof value==='number'&&Number.isFinite(value);
    const stats=value=>{const raw=value?.override_stats??value?.base_stats;return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:null;},base=stats(item),other=equipped?stats(equipped):{};
    if(!base||!other)return null;
    const level=value=>value==null?0:Number.isInteger(value.reinforce_level??0)&&(value.reinforce_level??0)>=0&&(value.reinforce_level??0)<=15?(value.reinforce_level??0):null,aLevel=level(item),bLevel=level(equipped);
    // Same positive-only reinforcement and integer rounding as the official tooltip helper.
    const current=(key,value,n)=>{if(n===null)return null;if(!boosted.has(key)||value<=0)return value;const result=value*(1+n*(n+1)/200);return rounded.has(key)?Math.round(result):result;};
    const keys=new Set([...Object.keys(base),...Object.keys(other)]),rows=[];
    for(const key of keys){const a=base[key]??0,b=other[key]??0;if(!finite(a)||!finite(b)||!a&&!b)continue;const nowA=current(key,a,aLevel),nowB=current(key,b,bLevel);rows.push({key,base:a-b,equippedLevel:bLevel===null?null:current(key,a,bLevel)-current(key,b,bLevel),itemLevel:aLevel===null?null:current(key,a,aLevel)-current(key,b,aLevel),current:nowA===null||nowB===null?null:nowA-nowB});}
    for(const group of ['affinity_bonus','element_coeff_levels']){const values=new Map();for(const key of ['fire','water','lightning','earth','wind','light','dark']){const a=item?.[group]?.[key]??0,b=equipped?.[group]?.[key]??0;if(!finite(a)||!finite(b)||!a&&!b)continue;const signature=JSON.stringify([a-b]);if(!values.has(signature))values.set(signature,{members:[],base:a-b,equippedLevel:a-b,itemLevel:a-b,current:a-b});values.get(signature).members.push(key);}const grouped=[...values.values()].sort((a,b)=>b.members.length-a.members.length);for(const row of grouped)rows.push({...row,key:group+'.'+row.members.join(','),affinityGroup:group});}

    return {aLevel,bLevel,rows};
  }
  function initEquipmentHoverCompare(){
    const KEY=Symbol.for('aether.equipment.hover.compare');if(window[KEY])return;const items=new WeakMap(),app=document.getElementById('app');if(!app)return;
    const formats={number:new Intl.NumberFormat('zh-CN',{maximumFractionDigits:3}),percent:new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2})};
    const statIcons={max_hp:['mdi-heart-pulse','#ff7a5c'],max_ap:['mdi-battery-high','#5de0ff'],atk:['mdi-sword-cross','#ffae5e'],spe:['mdi-speedometer','#8be9ff'],luck:['mdi-clover','#b6ff8d'],crit_rate:['mdi-crosshairs-gps','#f9ffb5'],crit_dmg:['mdi-flash-alert','#ffd166'],armor:['mdi-shield','#9eb4ff'],evasion_rate:['mdi-shield-refresh-outline','#a8e6cf'],heal_bonus:['mdi-medical-bag','#ff9ff3'],ap_gain_rate:['mdi-battery-charging','#5de0ff'],debuff_resist:['mdi-shield-cross-outline','#c9d6ff']},elementIcons={fire:['mdi-fire','#ff7a5c'],water:['mdi-water','#62d1ff'],lightning:['mdi-lightning-bolt','#ffd451'],earth:['mdi-terrain','#9bd36e'],wind:['mdi-weather-windy','#6eeedc'],light:['mdi-white-balance-sunny','#f9ffb5'],dark:['mdi-moon-waning-crescent','#a98bff']};
    const labels={max_hp:'HP',max_ap:'AP',atk:'攻击',spe:'速度',luck:'幸运',crit_rate:'暴击率',crit_dmg:'暴击伤害',armor:'护甲',evasion_rate:'回避',heal_bonus:'治疗加成',ap_gain_rate:'AP恢复率',debuff_resist:'弱化耐性'},elements={fire:'火',water:'水',lightning:'雷',earth:'地',wind:'风',light:'光',dark:'暗'},percent=new Set(['crit_rate','crit_dmg','evasion_rate','heal_bonus','ap_gain_rate','debuff_resist']),supported='.equip-tooltip-surface,.item-chip-tooltip';let active=null,timers=[],section=null,host=null,originalStyle=null,nativeRows=[],mobilePending=null,sheetView=null;
    window[KEY]={bind(node,item){items.set(node,item);},sheet:syncSheet,pruneSheet,owns(tip){if(tip.matches('.item-sheet'))return sheetMatches(tip);const item=active&&items.get(active.node),title=tip.querySelector('.equip-tooltip>strong,.tooltip-name')?.textContent?.trim().replace(/^\+\d+\s*/, '');return !!item&&title===String(item.name||item.item_id||'').trim();}};
    const style=element('style');style.textContent=`.amv-equipment-comparison{flex-shrink:0;margin-top:10px;padding-top:9px;border-top:1px solid #8fa4c54a;color:#d8e5f5;font:11px/1.6 system-ui;white-space:normal;text-align:left}.amv-equipment-comparison strong{display:block;font-size:11px;font-weight:550;color:#adcfcf;overflow-wrap:anywhere}.amv-equipment-comparison p{margin:3px 0 7px;font-size:10px;color:#8fa5bf}.amv-equipment-comparison table{border-collapse:collapse;width:100%;font-size:11px;font-variant-numeric:tabular-nums}.amv-equipment-comparison th{font-weight:400;color:#8fa5bf;font-size:10px;text-align:right;padding:3px 3px 5px}.amv-equipment-comparison td{padding:4px 3px;border-top:1px solid #8fa4c51b;text-align:right;white-space:nowrap}.amv-equipment-comparison :is(th,td):first-child{text-align:left;padding-right:12px;color:#bacce1;white-space:normal}.amv-compare-stat{display:flex;align-items:baseline;flex-wrap:wrap;gap:3px 5px}.amv-compare-elements{display:inline-flex;gap:2px;flex-wrap:wrap}.amv-equipment-compare-host .amv-native-equipment-value,.amv-equipment-compare-sheet .amv-native-equipment-value{display:none!important}.amv-compare-stat .mdi{width:13px;flex:none;font-size:13px;text-align:center}.amv-compare-stat>span{min-width:0}.amv-equipment-comparison [data-diff=up]{color:#6ddc8e}.amv-equipment-comparison [data-diff=down]{color:#ff6b6b}.amv-equipment-comparison [data-diff=same]{color:#91a3ba}.equip-tooltip-surface.amv-equipment-compare-host{width:min(460px,calc(100vw - 20px))!important;max-height:calc(100dvh - 24px)!important;overflow:visible!important;box-sizing:border-box}.equip-tooltip-surface.amv-equipment-compare-host>.equip-tooltip{width:100%!important;max-width:none!important;min-width:0;max-height:calc(100dvh - 24px - var(--amv-tooltip-inset,40px));overflow:auto;box-sizing:border-box}.item-chip-tooltip.amv-equipment-compare-host{width:min(460px,calc(100vw - 20px))!important;max-height:calc(100dvh - 20px);overflow:auto;box-sizing:border-box}html .item-sheet.amv-equipment-sheet{max-height:min(85vh,calc(100dvh - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px) - 3.5rem));min-height:0;overflow:hidden}.amv-equipment-sheet>.item-sheet__head,.amv-equipment-sheet>.item-sheet__actions{flex:none}.amv-equipment-sheet>.item-sheet__body{min-height:0;overflow:auto;overscroll-behavior:contain}.amv-equipment-sheet .amv-equipment-comparison{font-size:12px}.amv-equipment-sheet .amv-equipment-comparison table{font-size:12px}.item-sheet.amv-equipment-sheet .amv-equipment-comparison strong{font-size:12px}.item-sheet .amv-item-sheet-pin{display:inline-flex;align-items:center;justify-content:center;gap:.3rem;padding:.6rem .35rem;font:inherit;font-size:.8rem;border:1px solid #ffffff20;border-radius:999px;background:transparent;color:#aebfd4;cursor:pointer}.item-sheet .amv-item-sheet-pin[aria-pressed=true]{color:#f4cd79;border-color:#f4cd7977;background:#f4cd7910}.item-sheet .amv-item-sheet-pin:focus-visible{outline:2px solid #87d9c3;outline-offset:2px}@media(max-width:360px){.item-sheet.amv-equipment-sheet .amv-item-sheet-pin-row{grid-auto-flow:row;grid-template-columns:repeat(2,minmax(0,1fr))}.item-sheet .amv-item-sheet-pin-row>button{min-width:0}}`;document.head.append(style);
    function clear(){for(const timer of timers)clearTimeout(timer);timers=[];for(const row of nativeRows)row.classList.remove('amv-native-equipment-value');nativeRows=[];section?.remove();section=null;if(host){host.classList.remove('amv-equipment-compare-host','amv-equipment-compare-sheet');host.style.removeProperty('--amv-tooltip-inset');if(originalStyle!==null)host.setAttribute('style',originalStyle);}host=null;originalStyle=null;}
    function stop(){active=null;for(const timer of timers)clearTimeout(timer);timers=[];if(!host?.matches('.item-sheet'))clear();}
    function itemAt(node){return items.get(node)||null;}
    function name(key){if(labels[key])return labels[key];if(key.startsWith('amplify_'))return (elements[key.slice(8)]||key.slice(8))+'元素强化';const [group,part]=key.split('.');return elements[part]?elements[part]+(group==='affinity_bonus'?'亲和加成':'武器亲和'):key;}
    function statCell(row){const key=row.key,cell=element('td'),wrap=element('span',undefined,'amv-compare-stat'),elementKey=key.startsWith('amplify_')?key.slice(8):key.split('.')[1],addIcon=(target,info)=>{if(!info)return;const icon=element('i',undefined,'mdi '+info[0]);icon.style.color=info[1];icon.setAttribute('aria-hidden','true');target.append(icon);};
      if(row.members){cell.setAttribute('aria-label',row.members.map(key=>elements[key]).join('、')+(row.affinityGroup==='affinity_bonus'?'亲和加成':'武器亲和'));if(row.affinityGroup==='element_coeff_levels')addIcon(wrap,['mdi-sword','#9db0c7']);const icons=element('span',undefined,'amv-compare-elements');for(const key of row.members)addIcon(icons,elementIcons[key]);wrap.append(icons);}else{addIcon(wrap,statIcons[key]||elementIcons[elementKey]);wrap.append(element('span',name(key)));}cell.append(wrap);return cell;
    }
    function hideNativeValues(inner){let affinity=false,reinforce=false;for(const row of inner.children){if(row===section)continue;const heading=row.matches('small.tooltip-muted'),text=row.textContent.trim();if(heading)affinity=['亲和力加成','武器亲和'].includes(text);const upgrade=!!row.querySelector('.mdi-hammer-wrench');if(upgrade)reinforce=true;const footer=row.matches('div')&&!!row.querySelector(':scope > small.tooltip-muted')&&/^(当前已装备[：:]|该槽位当前为空)/.test(text);if(row.matches('.tooltip-line-flex')||heading&&affinity||affinity&&row.matches('.tooltip-line,.tooltip-affinity-row')||upgrade||reinforce&&row.matches('.tooltip-line')||footer){row.classList.add('amv-native-equipment-value');nativeRows.push(row);}}}
    function diff(key,value){const cell=element('td');if(value===null){cell.textContent='—';return cell;}const scale=percent.has(key)||key.startsWith('amplify_')?100:1,number=Number((value*scale).toFixed(scale===100?2:3)),shown=formats[scale===100?'percent':'number'].format(number);cell.dataset.diff=number>0?'up':number<0?'down':'same';cell.textContent='('+(number>0?'+':'')+shown+(scale===100?'%':'')+')';return cell;}
    function attach(token){if(active!==token||!token.node.isConnected||document.hidden)return;const item=itemAt(token.node);if(!item)return;const title=String(item.name||item.item_id||'').trim();let tip=null;
      const valid=candidate=>{if(!candidate?.isConnected)return false;const rect=candidate.getBoundingClientRect();if(!rect.width||!rect.height||rect.right<=0||rect.bottom<=0||rect.left>=innerWidth||rect.top>=innerHeight)return false;for(let parent=candidate;parent&&parent!==document.body;parent=parent.parentElement){const style=getComputedStyle(parent);if(parent.hidden||parent.getAttribute('aria-hidden')==='true'||style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return false;}return candidate.querySelector('.equip-tooltip>strong,.tooltip-name')?.textContent?.trim().replace(/^\+\d+\s*/, '')===title;};
      const ids=(token.node.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean);let described=false;for(const id of ids){const owner=document.getElementById(id),candidate=owner?.matches(supported)?owner:owner?.querySelector(supported);if(candidate){described=true;if(valid(candidate)){tip=candidate;break;}}}
      if(!tip&&!described)for(const candidate of [...document.querySelectorAll(supported)].reverse())if(valid(candidate)){tip=candidate;break;}
      if(!tip)return;renderComparison(tip,item);
    }
    function renderComparison(tip,item,sheet=false){clear();const status=app.__vue_app__?.config?.globalProperties?.$pinia?._s?.get('player')?.statusData;if(!Array.isArray(status?.equipment_slots))return false;
      const equipped=status.equipment_slots.find(row=>row.slot===item.slot)?.item||null;if(equipped&&item.uuid&&equipped.uuid===item.uuid)return false;const model=equipmentHoverComparison(item,equipped);if(!model||!model.rows.length)return false;
      for(const timer of timers)clearTimeout(timer);timers=[];section=element('section',undefined,'amv-equipment-comparison');section.dataset.amvEquipmentComparison='';section.append(element('strong',equipped?'对比身上：'+(equipped.name||equipped.item_id||'装备')+' +'+(model.bLevel??'?'):'该部位未装备 · 以空槽为基准'));
      const table=element('table'),head=element('thead'),header=element('tr'),body=element('tbody');table.setAttribute('aria-label','装备基础与当前强化差值');for(const title of ['属性','均 +0','均 +'+(model.bLevel??'?'),'均 +'+(model.aLevel??'?'),'各自当前'])header.append(element('th',title));head.append(header);for(const row of model.rows){const line=element('tr');line.dataset.compareStat=row.key;line.append(statCell(row),diff(row.key,row.base),diff(row.key,row.equippedLevel),diff(row.key,row.itemLevel),diff(row.key,row.current));body.append(line);}table.append(head,body);section.append(table);host=tip;const inner=sheet?tip.querySelector('.item-sheet__info'):tip.matches('.equip-tooltip-surface')?tip.querySelector('.equip-tooltip'):tip;if(!inner){clear();return false;}if(tip.matches('.item-chip-tooltip'))originalStyle=tip.getAttribute('style')||'';hideNativeValues(inner);const outerStyle=getComputedStyle(tip),innerStyle=getComputedStyle(inner),inset=['paddingTop','paddingBottom','borderTopWidth','borderBottomWidth'].reduce((sum,key)=>sum+(parseFloat(outerStyle[key])||0),0)+(parseFloat(innerStyle.marginTop)||0)+(parseFloat(innerStyle.marginBottom)||0);if(!sheet)tip.style.setProperty('--amv-tooltip-inset',inset+'px');const heading=inner.querySelector(':scope > strong,:scope > .tooltip-header');if(heading)heading.after(section);else inner.append(section);tip.classList.add(sheet?'amv-equipment-compare-sheet':'amv-equipment-compare-host');
      if(tip.matches('.item-chip-tooltip')){const rect=tip.getBoundingClientRect();tip.style.bottom='auto';tip.style.top=Math.max(10,Math.min(rect.top,innerHeight-rect.height-10))+'px';tip.style.left=Math.max(10,Math.min(rect.left,innerWidth-rect.width-10))+'px';tip.style.transform='none';}
      return true;
    }
    function role(){try{return sessionStorage.getItem(ACTIVE)||'current';}catch{return 'current';}}
    function visibleSheet(tip){if(!tip?.isConnected||!tip.getClientRects().length)return false;for(let node=tip;node&&node!==document.body;node=node.parentElement){const style=getComputedStyle(node);if(node.hidden||node.getAttribute('aria-hidden')==='true'||style.display==='none'||style.visibility==='hidden')return false;}return true;}
    function sheetMatches(tip){return !!mobilePending&&mobilePending.role===role()&&tip.querySelector('.item-sheet__title')?.textContent?.trim().replace(/^\+\d+\s*/, '')===String(mobilePending.item.name||mobilePending.item.item_id||'').trim();}
    function disposeSheet(){const old=sheetView;sheetView=null;if(!old)return;if(host===old.tip)clear();old.pin?.remove();old.row?.classList.remove('amv-item-sheet-pin-row');old.tip.classList.remove('amv-equipment-sheet');}
    function rememberSheet(event){const node=event.target?.closest?.('.bag-grid-item');if(!node||!app.contains(node)||event.target.closest('.amv-bag-pin'))return;stop();const item=itemAt(node);if(!item||!Object.hasOwn(GEAR_SLOTS,item.slot)||item.slot==='none'){mobilePending=null;disposeSheet();return;}if(mobilePending?.item===item&&mobilePending.role===role())return;disposeSheet();mobilePending={item,role:role()};}
    function readSheetPins(view){try{const value=JSON.parse(localStorage.getItem('aether-bag-pins-v1:'+view.role)||'[]');return new Set(Array.isArray(value)?value.filter(uuid=>typeof uuid==='string'):[]);}catch{return new Set();}}
    function refreshSheetPin(view){if(!view?.pin)return;const pinned=readSheetPins(view).has(view.item.uuid),label=pinned?'取消置顶':'置顶';if(view.pin.getAttribute('aria-pressed')===String(pinned)&&view.pin.getAttribute('aria-label')===label)return;view.pin.setAttribute('aria-pressed',String(pinned));view.pin.setAttribute('aria-label',label);view.pin.title=label+'此装备';view.pin.replaceChildren(element('i',undefined,'mdi '+(pinned?'mdi-pin':'mdi-pin-outline')),element('span',label));view.pin.querySelector('i').setAttribute('aria-hidden','true');}
    function ensureSheetPin(view){if(typeof view.item.uuid!=='string'||!view.item.uuid)return;const actions=view.tip.querySelector('.item-sheet__actions');if(!actions)return;const row=actions.querySelector(':scope > .item-sheet__row')||actions;if(view.row&&view.row!==row)view.row.classList.remove('amv-item-sheet-pin-row');view.row=row;if(row!==actions&&!row.classList.contains('amv-item-sheet-pin-row'))row.classList.add('amv-item-sheet-pin-row');
      if(!view.pin){view.pin=button('',event=>{event.preventDefault();event.stopPropagation();if(sheetView!==view||!visibleSheet(view.tip)||view.role!==role())return;const pins=readSheetPins(view),pinned=!pins.has(view.item.uuid);if(pinned)pins.add(view.item.uuid);else pins.delete(view.item.uuid);const key='aether-bag-pins-v1:'+view.role,value=JSON.stringify([...pins]);try{localStorage.setItem(key,value);}catch{view.pin.setAttribute('aria-label','置顶保存失败，点击重试');view.pin.title='本机保存失败，点击重试';view.pin.replaceChildren(element('span','保存失败'));return;}refreshSheetPin(view);notifyPinChange(view.role,view.item.uuid,pinned);window.dispatchEvent(new StorageEvent('storage',{key,newValue:value}));});view.pin.className='ae-btn amv-item-sheet-pin';view.pin.dataset.amvSheetPin='';const sample=row.querySelector('button');for(const attr of sample?.attributes||[])if(attr.name.startsWith('data-v-'))view.pin.setAttribute(attr.name,'');}
      if(view.pin.parentElement!==row)row.append(view.pin);refreshSheetPin(view);
    }
    function syncSheet(tip){if(!visibleSheet(tip)||!sheetMatches(tip)){if(sheetView?.tip===tip)disposeSheet();return false;}const item=mobilePending.item,inner=tip.querySelector('.item-sheet__info');if(!inner)return true;if(!sheetView||sheetView.tip!==tip||sheetView.pending!==mobilePending){disposeSheet();sheetView={tip,item,role:mobilePending.role,pending:mobilePending,signature:null,pin:null,row:null,compared:false};}const view=sheetView;if(!tip.classList.contains('amv-equipment-sheet'))tip.classList.add('amv-equipment-sheet');ensureSheetPin(view);
      const status=app.__vue_app__?.config?.globalProperties?.$pinia?._s?.get('player')?.statusData,equipped=status?.equipment_slots?.find(row=>row.slot===item.slot)?.item,fields=value=>value?[value.uuid,value.name,value.slot,value.reinforce_level,value.override_stats,value.base_stats,value.affinity_bonus,value.element_coeff_levels]:null,signature=JSON.stringify([fields(item),fields(equipped)]);if(view.signature===signature&&(!view.compared||host===tip&&section?.isConnected&&section.parentElement===inner))return true;view.signature=signature;view.compared=renderComparison(tip,item,true);return true;
    }
    function pruneSheet(){if(sheetView&&!sheetView.tip.isConnected)disposeSheet();}

    function start(event){if(event.pointerType==='touch')return;const node=event.target?.closest?.('.bag-grid-item');if(!node||!app.contains(node)||node.contains(event.relatedTarget)||active?.node===node)return;const item=itemAt(node);if(!item||!Object.hasOwn(GEAR_SLOTS,item.slot)||item.slot==='none')return;stop();const token={node};active=token;for(const delay of [0,100,300,650,1100])timers.push(setTimeout(()=>attach(token),delay));}
    function leave(event){if(active?.node.contains(event.target)&&!active.node.contains(event.relatedTarget))stop();}
    app.addEventListener('pointerover',start,{passive:true});app.addEventListener('pointerout',leave,{passive:true});app.addEventListener('focusin',start);app.addEventListener('focusout',leave);app.addEventListener('pointerdown',rememberSheet,{capture:true,passive:true});app.addEventListener('click',rememberSheet,{capture:true,passive:true});window.addEventListener('blur',stop);document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else{const tip=document.querySelector('.item-sheet');if(tip)syncSheet(tip);}});window.addEventListener('storage',event=>{if(sheetView&&(event.key===null||event.key==='aether-bag-pins-v1:'+sheetView.role))refreshSheetPin(sheetView);});
  }

  function initDecomposeLayout(){
    const KEY=Symbol.for('aether.decompose.layout');if(window[KEY])return;window[KEY]=true;
    const style=element('style');style.id='aether-decompose-layout-style';style.textContent=`
      .rarity-panels .rarity-panel-content .item-grid>.item-chip{transition:background-color .15s,border-color .15s}
      .rarity-panels .rarity-panel-content .item-grid>.item-chip>.item-chip-check{position:absolute;top:-.3rem;right:-.3rem;z-index:1;font-size:.85rem;line-height:1;border-radius:50%;background:#0d1935;box-shadow:0 0 0 2px #0d1935;pointer-events:none}
    `;document.head.append(style);
  }

  function initSpectrumLevelTooltips(){
    const guard=Symbol.for('aether.spectrum.level.tooltips');if(window[guard])return;window[guard]=true;
    const catalog=__AETHEROS_SPECTRUM_LEVELS__;
    const supported='.prism-socket-tt,.item-chip-tooltip,.formula-tooltip-surface,.equip-tooltip-surface,.item-sheet';
    const normalize=value=>String(value||'').trim().replace(/^(?:纯净)?光谱[·・\s]*/,'');
    const aliases=new Map();for(const [id,row]of Object.entries(catalog)){const name=normalize(row.name);aliases.set(name,aliases.has(name)?null:id);}
    const style=document.createElement('style');style.id='aether-spectrum-level-style';style.textContent=`
      .amv-spectrum-levels{border-top:1px solid #879ab24a;margin-top:9px;padding-top:8px;font-size:12px;line-height:1.55;font-family:inherit;white-space:normal;text-align:left;color:inherit}
      .amv-spectrum-levels__title{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;font-weight:650;margin-bottom:6px}.amv-spectrum-levels__title small{font-size:10px;font-weight:400;opacity:.7}
      .amv-spectrum-levels table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}.amv-spectrum-levels th,.amv-spectrum-levels td{padding:4px 5px;border-bottom:1px solid #879ab22a;text-align:right;vertical-align:middle;white-space:nowrap}.amv-spectrum-levels th:first-child{width:46%;text-align:left;white-space:normal;min-width:75px;font-weight:400}.amv-spectrum-levels thead th{font-weight:500;opacity:.75}.amv-spectrum-levels [data-current]{color:#6eeedc!important;background:#6eeedc14;font-weight:700;opacity:1!important}.amv-spectrum-levels__note{font-size:11px;line-height:1.5;opacity:.7;margin-top:6px}
      .amv-spectrum-tip:not(.item-sheet){white-space:normal!important;max-width:min(380px,calc(100vw - 20px))!important}.item-chip-tooltip.amv-spectrum-tip{width:min(360px,calc(100vw - 20px))!important;max-height:calc(100vh - 20px);overflow:auto;box-sizing:border-box}.prism-socket-tt.amv-spectrum-tip{padding:10px 12px!important}.amv-spectrum-tip .prism-tt-inner{display:block}.equip-tooltip-surface.amv-spectrum-tip{width:min(360px,calc(100vw - 20px))!important;box-sizing:border-box}.equip-tooltip-surface.amv-spectrum-tip>.equip-tooltip{width:auto!important;max-width:none!important}
      .prism-socket-tt.v-overlay__content.amv-spectrum-tip{background:#101c30!important;color:#e6edf9!important;width:min(360px,calc(100vw - 20px))!important;box-sizing:border-box;padding:12px 14px!important;border:1px solid #526780!important;border-radius:10px!important;box-shadow:0 10px 30px #02061799!important;font-size:13px;line-height:1.6}
      .prism-socket-tt.amv-spectrum-tip .prism-tt-inner{display:block;white-space:normal;background:transparent;border:0;box-shadow:none;padding:0;color:#e6edf9;font-size:13px;line-height:1.6}
      .prism-socket-tt.amv-spectrum-tip .amv-spectrum-levels{color:#e6edf9}.prism-socket-tt.amv-spectrum-tip .amv-spectrum-levels__title small,.prism-socket-tt.amv-spectrum-tip .amv-spectrum-levels__note{opacity:1;color:#b1bfd2}
      @media(max-width:400px){.amv-spectrum-levels th,.amv-spectrum-levels td{padding:4px 3px}.amv-spectrum-levels table{font-size:11px}}
    `;document.head.append(style);
    const make=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
    function fromValue(value,next=false){
      if(!value||typeof value!=='object')return null;
      const id=value.talent_id||value.item_id||value.id;
      if(!Object.hasOwn(catalog,id))return null;
      const raw=value.level??value.talent_level,level=Number.isInteger(raw)&&raw>=1?Math.min(catalog[id].max_level,raw+(next?1:0)):null;
      return {id,level};
    }
    function fromProps(props){return fromValue(props?.talent,props?.next===true)||fromValue(props?.item);}
    function owner(tip){
      for(let node=tip;node;node=node.parentElement){
        let instance=node.__vueParentComponent;
        while(instance){const value=fromProps(instance.props);if(value)return value;instance=instance.parent;}
      }
      const app=document.getElementById('app')?.__vue_app__,seen=new Set();let found=null;
      // 仅在提示出现时查看已挂载的 VNode；不改官网组件、不读取额外游戏接口。
      function visit(node,context,inventory){
        if(!node||typeof node!=='object'||seen.has(node))return;seen.add(node);
        if(Array.isArray(node)){for(const child of node)visit(child,context,inventory);return;}
        const props=node.component?.props;
        if(Array.isArray(props?.backpackConsumables))inventory=new Map(props.backpackConsumables.map(item=>[item.uuid,item]));
        if(inventory?.has(node.key))context=fromValue(inventory.get(node.key));
        context=fromProps(node.component?.props)||context;
        if(node.el===tip&&context)found=context;
        if(node.component)visit(node.component.subTree,context,inventory);
        else if(node.suspense)visit(node.suspense.activeBranch,context,inventory);
        else if(Array.isArray(node.children))visit(node.children,context,inventory);
      }
      visit(app?._container?._vnode||app?._instance?.subTree||app?._vnode,null);return found;
    }
    function byTitle(tip){
      const nameNode=tip.querySelector('.prism-tt-inner,.tooltip-name,.equip-tooltip>strong,.item-sheet__title');if(!nameNode)return null;
      const match=nameNode.textContent.trim().match(/^(.*?)(?:\s*[·・]?\s*Lv\s*(\d+))?$/i),id=aliases.get(normalize(match?.[1]));
      if(!id)return null;
      if(tip.matches('.item-chip-tooltip')&&!/^(?:纯净)?光谱[·・\s]/.test(nameNode.textContent.trim()))return null;
      return {id,level:match?.[2]?Math.min(catalog[id].max_level,Number(match[2])):null};
    }
    function levelTable(value){
      const entry=catalog[value.id],section=make('section');section.className='amv-spectrum-levels';section.dataset.amvSpectrumLevels=value.id;
      const title=make('div','各级效果');title.className='amv-spectrum-levels__title';title.append(make('small',value.level?'当前 Lv'+value.level:'等级参数'));section.append(title);
      if(entry.max_level===1){if(entry.description)section.append(make('div',entry.description));const note=make('div','仅 Lv1，不可升级');note.className='amv-spectrum-levels__note';section.append(note);return section;}
      const table=make('table'),head=make('thead'),header=make('tr'),body=make('tbody');table.setAttribute('aria-label',normalize(entry.name)+'各级效果');header.append(make('th','效果'));
      function cell(tag,text,level){const node=make(tag,text);if(level===value.level)node.dataset.current='';return node;}
      for(let level=1;level<=entry.max_level;level++){const node=cell('th','Lv'+level,level);node.scope='col';header.append(node);}head.append(header);
      for(const field of entry.fields){
        if(!Number.isFinite(field.base)||!Number.isFinite(field.increment))continue;
        const row=make('tr'),label=make('th',field.label);label.scope='row';row.append(label);
        for(let level=1;level<=entry.max_level;level++){const number=Number((field.base+field.increment*(level-1)).toFixed(6));row.append(cell('td',number+(field.unit||''),level));}body.append(row);
      }
      table.append(head,body);section.append(table);
      const note=make('div','列出等级参数；亲和与面板加成按公式换算，触发条件沿用原说明。');note.className='amv-spectrum-levels__note';section.append(note);return section;
    }
    const states=new WeakMap();
    function sync(tip){
      if(tip.matches('.item-sheet'))window[Symbol.for('aether.equipment.hover.compare')]?.sheet(tip);
      const host=tip.matches('.item-sheet')?tip.querySelector('.item-sheet__info'):tip.matches('.equip-tooltip-surface')?tip.querySelector('.equip-tooltip'):tip;
      if(!host)return;
      // ItemChip explicitly labels ordinary equipment. It cannot be a prism;
      // skip the production Vue fallback tree walk even when no instance links exist.
      const equipment=tip.matches('.item-chip-tooltip')&&tip.querySelector(':scope > .tooltip-meta > .tooltip-kind')?.textContent.trim()==='装备';
      const value=equipment||window[Symbol.for('aether.equipment.hover.compare')]?.owns(tip)?null:owner(tip)||byTitle(tip),previous=states.get(tip),signature=value?value.id+':'+value.level:'';
      if(previous?.signature===signature&&(!value||tip.querySelector('[data-amv-spectrum-levels]')))return;
      host.querySelector(':scope > [data-amv-spectrum-levels]')?.remove();
      if(!value){if(previous){tip.classList.remove('amv-spectrum-tip');if(tip.matches('.item-chip-tooltip'))tip.setAttribute('style',previous.style);}states.delete(tip);return;}
      const originalStyle=previous?.style??tip.getAttribute('style')??'';
      if(previous&&tip.matches('.item-chip-tooltip'))tip.setAttribute('style',originalStyle);
      host.append(levelTable(value));tip.classList.add('amv-spectrum-tip');states.set(tip,{signature,style:originalStyle});
      if(tip.matches('.item-chip-tooltip')){
        const rect=tip.getBoundingClientRect();tip.style.bottom='auto';tip.style.top=Math.max(10,Math.min(rect.top,innerHeight-rect.height-10))+'px';tip.style.left=Math.max(10,Math.min(rect.left,innerWidth-rect.width-10))+'px';tip.style.transform='none';
      }
    }
    const pending=new Set();let scheduled=false;
    function schedule(node){if(!node||node.nodeType!==1)return;const parent=node.closest(supported);if(parent)pending.add(parent);if(node.matches(supported))pending.add(node);node.querySelectorAll(supported).forEach(tip=>pending.add(tip));if(pending.size&&!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;for(const tip of pending)if(tip.isConnected)sync(tip);pending.clear();});}}
    new MutationObserver(records=>{window[Symbol.for('aether.equipment.hover.compare')]?.pruneSheet();for(const record of records){schedule(record.target.nodeType===1?record.target:record.target.parentElement);for(const node of record.addedNodes)schedule(node);}}).observe(document.body,{childList:true,characterData:true,attributes:true,attributeFilter:['class'],subtree:true});
    schedule(document.body);
  }

  function initReinforceBulkRead(){
    if(window.top!==window||window[Symbol.for('aether.history.bulk')])return;const card=document.querySelector('[data-amv-pin-dialog] .amv-pin-card');if(!card)return;window[Symbol.for('aether.history.bulk')]=true;
    const section=element('section',undefined,'amv-history-bulk'),title=element('strong','批量读取强化进度'),intro=element('p','读取当前强化等级与失败次数，保留已有记录；不会执行强化，过去未记录的成功次数无法补回。'),actions=element('div',undefined,'amv-pin-actions'),current=button('读取当前角色',()=>begin(false)),all=button('读取全部角色',()=>begin(true)),stop=button('停止读取',()=>{if(run){run.stopped=true;stop.disabled=true;feedback.textContent='已请求停止，当前读取完成后不再继续';}}),feedback=element('p');let run=null,character='';
    section.dataset.amvHistoryBulk='';current.dataset.amvHistoryCurrent='';all.dataset.amvHistoryAll='';stop.dataset.amvHistoryStop='';feedback.dataset.amvHistoryFeedback='';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');stop.hidden=true;actions.append(current,all,stop);section.append(title,intro,actions,feedback);(card.querySelector('[data-amv-sync-read]')||card).append(section);
    const readCharacter=()=>{try{return sessionStorage.getItem(ACTIVE)||localStorage.getItem(ACTIVE)||'';}catch{return '';}};
    window.addEventListener('aether-pins-settings',event=>{character=typeof event.detail?.character==='string'?event.detail.character:readCharacter();current.textContent='读取当前角色'+(character?' · '+character:'');});
    async function get(path,who,active){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);let response;try{const url=new URL('/api/aether'+path,ORIGIN);if(who)url.searchParams.set('_aether_character',who);response=await fetch(url,{method:'GET',credentials:'same-origin',cache:'no-store',headers:who?{'X-Aether-Character':who}:{},signal:controller.signal});if(!response.ok){const error=new Error(response.status===401?'官网登录已失效，请重新登录后读取':response.status===429?'官网请求限流，请稍后再读取':'官网读取失败：HTTP '+response.status);error.stop=response.status===401||response.status===429;throw error;}const value=await response.json();if(value?.code!==0){const error=new Error('官网未返回有效状态');error.stop=[401,429].includes(value?.code);throw error;}const time=Date.parse(response.headers.get('Date')||'');active.now=Number.isFinite(time)?time:Date.now();return value.data;}finally{clearTimeout(timeout);}}
    async function begin(everyone){if(run)return;const active={stopped:false,now:Date.now()},who=character||readCharacter();if(!everyone&&!who){feedback.textContent='请先在官网选择角色，或使用读取全部角色';return;}run=active;current.disabled=all.disabled=true;stop.hidden=false;stop.disabled=false;let completed=0,total=0,count=0,skipped=0;const errors=[];
      try{const execute=async()=>{const journal=createReinforceHistory(localStorage,()=>active.now,()=>window.dispatchEvent(new Event('aether-history-change')));let roles;
        if(everyone){feedback.textContent='正在读取自有角色列表…';const account=await get('/account',null,active);if(!Array.isArray(account?.characters))throw Error('官网角色列表结构无效');roles=[...new Set(account.characters.filter(row=>typeof row?.username==='string'&&row.username.trim()&&row.username.length<=100&&row.type!=='offline_friend').map(row=>row.username))];if(roles.length>100)throw Error('角色数量异常，已停止读取');}else roles=[who];total=roles.length;
        for(const role of roles){if(active.stopped)break;feedback.textContent='正在读取 '+role+' · '+(completed+1)+' / '+total;try{const value=await get('/status',role,active),result=reinforceProgressFromStatus(role,value);skipped+=result.skipped;
            for(let i=0;i<result.records.length;i++){if(active.stopped)break;const row=result.records[i];journal.observe(row.character,row.uuid,row.info);if(journal.warning)throw Error(journal.warning);count++;if(i%50===49)await new Promise(resolve=>setTimeout(resolve,0));}
          }catch(error){errors.push(role+'：'+(error.name==='AbortError'?'读取超时':error.message));if(error.stop)active.stopped=true;}completed++;if(!active.stopped&&completed<total)await new Promise(resolve=>setTimeout(resolve,300));}
      };if(navigator.locks?.request)await navigator.locks.request('aether-history-bulk-read',{ifAvailable:true},async lock=>{if(!lock)throw Error('其他标签页正在批量读取，请等待完成');await execute();});else await execute();
      }catch(error){errors.push(error.name==='AbortError'?'读取超时':error.message);}finally{run=null;current.disabled=all.disabled=false;stop.hidden=true;feedback.textContent=(active.stopped?'已停止':'读取结束')+' · 已处理 '+completed+' / '+total+' 个角色，导入 '+count+' 件装备'+(skipped?'，跳过 '+skipped+' 条不完整数据':'')+(errors.length?'。'+errors.join('；'):'。已有历史保留，连接云同步后自动上传。');if(count)window.dispatchEvent(new Event('aether-history-sync-now'));}
    }
  }
  function initReinforceHistorySync(){
    if(window.top!==window||window[Symbol.for('aether.history.sync')])return;window[Symbol.for('aether.history.sync')]=true;
    const CONFIG='aether-pin-sync-v1',KEY='aether-history-sync-v1',PREFIX='aether-reinforce-history-v1:',STATUS=Symbol.for('aether.history.sync.status');let timer=null,busy=false,paused=false;
    function config(){try{const row=JSON.parse(localStorage.getItem(CONFIG)||'null'),url=new URL(row.server);return row.version===1&&url.origin===row.server&&(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))&&/^[A-Za-z0-9_-]{32,128}$/.test(row.token)&&/^[A-Za-z0-9_-]{20,80}$/.test(row.client_id)&&row.initial===null?row:null;}catch{return null;}}
    function status(message){const current=config();window[STATUS]={message,server:current?.server||''};window.dispatchEvent(new CustomEvent('aether-history-sync-status',{detail:window[STATUS]}));}
    function schedule(delay=1000){if(timer!==null||paused)return;timer=setTimeout(()=>{timer=null;synchronize();},delay);}
    const canonical=value=>value&&typeof value==='object'?Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
    async function hash(row){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(row))));return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');}
    function state(current){try{const row=JSON.parse(localStorage.getItem(KEY)||'null');if(row?.server===current.server&&row.client_id===current.client_id&&Number.isSafeInteger(row.cursor)&&row.cursor>=0&&row.sent&&typeof row.sent==='object'&&!Array.isArray(row.sent))return row;}catch{}return {server:current.server,client_id:current.client_id,cursor:0,sent:{},checked:0};}
    async function synchronize(force=false){
      if(busy||paused&&!force)return;const current=config();if(!current){status('强化记录仅存本机，连接数据同步后自动同步');return;}if(document.hidden&&!force){schedule(30000);return;}busy=true;
      try{const run=async()=>{
        const latest=config();if(!latest||latest.server!==current.server||latest.client_id!==current.client_id)return;const progress=state(latest),records=[];let waiting=false,bytes=0;
        for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith(PREFIX))continue;let row;try{const raw=localStorage.getItem(key);row=normalizeReinforceRecord(JSON.parse(raw),true);if(!row)continue;const normalized=JSON.stringify(row);if(normalized!==raw)localStorage.setItem(key,normalized);}catch{continue;}if(progress.sent[key]===await hash(row))continue;const size=new TextEncoder().encode(JSON.stringify(row)).length;if(size>650000)throw new Error('单件强化记录过大，请保留本机数据后检查');if(records.length<50&&bytes+size<=650000){records.push(row);bytes+=size;}else waiting=true;}
        if(!records.length&&!force&&Date.now()-progress.checked<30000){schedule(30000);return;}status('正在同步强化记录…');const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);let response,data;
        try{response=await fetch(latest.server+'/api/aetheros/history/sync',{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',headers:{'Content-Type':'application/json','Authorization':'Bearer '+latest.token},body:JSON.stringify({client_id:latest.client_id,cursor:progress.cursor,records}),signal:controller.signal});data=await response.json().catch(()=>({}));}finally{clearTimeout(timeout);}
        if(!response.ok){if(response.status===409&&typeof data.detail==='string'&&data.detail.includes('进度已重置')){progress.cursor=0;progress.sent={};localStorage.setItem(KEY,JSON.stringify(progress));}else if([401,403,409,413,422].includes(response.status))paused=true;throw new Error(response.status===404?'Web 尚未更新，强化记录保留在本机':typeof data.detail==='string'?data.detail:'强化记录同步暂不可用，本机记录保留');}
        if(data.version!==1||!Number.isSafeInteger(data.cursor)||data.cursor<progress.cursor||!Array.isArray(data.records)||data.records.length>100||!Array.isArray(data.accepted)||data.accepted.length>50||typeof data.has_more!=='boolean'||[...data.accepted,...data.records].some(row=>!normalizeReinforceRecord(row)))throw new Error('强化历史响应无效，本机记录保留');
        const active=config();if(!active||active.server!==latest.server||active.client_id!==latest.client_id||active.token!==latest.token)return;
        for(const remote of [...data.accepted,...data.records]){const key=PREFIX+JSON.stringify([remote.character,remote.uuid]);let local=null;try{local=JSON.parse(localStorage.getItem(key)||'null');}catch{}const merged=mergeReinforceRecord(local,remote);if(!merged)throw new Error('强化历史合并失败，本机记录保留');const value=JSON.stringify(merged);if(localStorage.getItem(key)!==value){localStorage.setItem(key,value);window.dispatchEvent(new StorageEvent('storage',{key,newValue:value}));}progress.sent[key]=await hash(normalizeReinforceRecord(remote));}
        progress.cursor=data.cursor;progress.checked=Date.now();localStorage.setItem(KEY,JSON.stringify(progress));status('强化记录已同步');if(data.has_more||waiting)schedule(1000);
      };if(navigator.locks?.request)await navigator.locks.request('aether-history-network',run);else await run();}
      catch(error){status(error.name==='AbortError'?'强化记录同步超时，本机记录保留':error.message||'强化记录同步失败，本机记录保留');}
      finally{busy=false;if(!paused)schedule(30000);}
    }
    window.addEventListener('aether-history-change',()=>schedule());window.addEventListener('aether-history-sync-now',()=>{paused=false;synchronize(true);});window.addEventListener('online',()=>{paused=false;schedule();});window.addEventListener('storage',event=>{if(event.key===CONFIG){paused=false;status('正在检查强化记录连接');schedule();}else if(event.key?.startsWith(PREFIX))schedule();});document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});status(config()?'强化记录已连接，等待同步':'强化记录仅存本机，连接数据同步后自动同步');schedule(1500);
  }
  function initPinSync(){
    if(window.top!==window||window[Symbol.for('aether.pin.sync')])return;window[Symbol.for('aether.pin.sync')]=true;
    const KEY='aether-pin-sync-v1',PREFIX='aether-bag-pins-v1:',DRAFT='aether-pin-draft-v1:',DEFAULT_SERVER='https://inf.muge.zj.cn';let busy=false,timer=null,message='未连接云同步',paused=false;
    const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),value=>value.toString(16).padStart(2,'0')).join('');
    function validServer(value){try{const url=new URL(value);return url.origin===value&&(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname));}catch{return false;}}
    function load(){try{const value=JSON.parse(localStorage.getItem(KEY)||'null');return value?.version===1&&validServer(value.server)&&typeof value.token==='string'&&/^[A-Za-z0-9_-]{32,128}$/.test(value.token)&&typeof value.client_id==='string'&&Array.isArray(value.pending)?value:null;}catch{return null;}}
    function save(value){try{localStorage.setItem(KEY,JSON.stringify(value));return true;}catch{paused=true;message='无法保存同步队列，已暂停；本机置顶仍保留';render();return false;}}
    function locked(name,fn){return navigator.locks?.request?navigator.locks.request('aether-pins-'+name,fn):Promise.resolve().then(fn);}
    function snapshots(){const result=new Map();for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith(PREFIX))continue;try{const values=JSON.parse(localStorage.getItem(key));if(Array.isArray(values))result.set(key.slice(PREFIX.length),values.filter(value=>typeof value==='string').slice(0,2000));}catch{}}return Object.fromEntries(result);}
    function drafts(config){const values=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith(DRAFT+config.client_id+':'))continue;try{const value=JSON.parse(localStorage.getItem(key));if(value&&typeof value.character==='string'&&typeof value.uuid==='string'&&typeof value.pinned==='boolean')values.push({key,character:value.character,uuid:value.uuid,pinned:value.pinned,order:value.order||0});}catch{}}return values.sort((a,b)=>a.order-b.order||a.key.localeCompare(b.key));}
    function flush(config){const batch=drafts(config);for(const draft of batch){config.next_seq++;config.pending.push({seq:config.next_seq,character:draft.character,uuid:draft.uuid,pinned:draft.pinned});}if(!save(config))throw new Error(message);for(const draft of batch)localStorage.removeItem(draft.key);return config;}
    function apply(data,config){const result=new Map(Object.entries(data.characters).map(([role,values])=>[role,new Set(values)]));for(const op of config.pending){if(!result.has(op.character))result.set(op.character,new Set());op.pinned?result.get(op.character).add(op.uuid):result.get(op.character).delete(op.uuid);}for(const role of Object.keys(snapshots()))if(!result.has(role))result.set(role,new Set());for(const [role,values]of result){const key=PREFIX+role,value=JSON.stringify([...values]);if(localStorage.getItem(key)===value)continue;localStorage.setItem(key,value);window.dispatchEvent(new StorageEvent('storage',{key,newValue:value}));}}
    const modal=element('section',undefined,'amv-pin-modal'),card=element('section',undefined,'amv-pin-card'),head=element('header',undefined,'amv-sync-head'),heading=element('div'),title=element('h2','数据同步'),badge=element('span','','amv-sync-badge'),close=button('×',hide),tabs=element('nav',undefined,'amv-sync-tabs'),body=element('div',undefined,'amv-sync-body'),footer=element('footer',undefined,'amv-sync-footer'),feedback=element('p'),pages=new Map(),tabButtons=new Map(),rows=new Map();
    let mode='merge',selectedTab='overview',returnFocus=null,lastConnection='',character='';
    modal.hidden=true;modal.dataset.amvPinDialog='';card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');title.id='aetheros-sync-title';card.setAttribute('aria-labelledby',title.id);close.className='amv-sync-close';close.setAttribute('aria-label','关闭');badge.dataset.amvSyncConnection='';heading.append(title,element('span','AetherOS · 多设备数据','amv-sync-kicker'));head.append(heading,badge,close);tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','数据同步');feedback.dataset.amvSyncFeedback='';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
    for(const [id,label]of [['overview','同步概览'],['read','读取强化'],['connection','连接管理']]){
      const tab=button(label,()=>selectTab(id));tab.id='aetheros-sync-tab-'+id;tab.dataset.amvSyncTab=id;tab.setAttribute('role','tab');tab.setAttribute('aria-controls','aetheros-sync-page-'+id);tabs.append(tab);tabButtons.set(id,tab);
      const page=element('section',undefined,'amv-sync-page');page.id='aetheros-sync-page-'+id;page.dataset.amvSyncPage=id;page.setAttribute('role','tabpanel');page.setAttribute('aria-labelledby',tab.id);page.hidden=true;pages.set(id,page);body.append(page);
    }
    const overview=pages.get('overview'),connection=pages.get('connection'),readPage=pages.get('read'),serverCard=element('div',undefined,'amv-sync-server'),serverCopy=element('div'),serverTitle=element('strong'),serverName=element('span'),manage=button('管理连接',()=>selectTab('connection')),statusList=element('div',undefined,'amv-sync-statuses');
    readPage.dataset.amvSyncRead='';serverCopy.append(serverTitle,serverName);serverCard.append(glyph('mdi-cloud-outline'),serverCopy,manage);overview.append(serverCard,feedback,statusList);
    const specs=[['pins','装备置顶','mdi-pin-outline'],['support','助战置顶','mdi-account-star-outline'],['history','强化记录','mdi-hammer-wrench'],['loadouts','装备预设','mdi-bookmark-multiple-outline'],['roles','账号排序与备注','mdi-account-edit-outline'],['inventory','物品库存','mdi-bag-personal-outline']];
    for(const [key,label,icon]of specs){
      const row=element('details',undefined,'amv-sync-status-row'),summary=element('summary'),name=element('span',label,'amv-sync-name'),state=element('span','','amv-sync-state'),detail=element('p');row.dataset.amvSyncRow=key;state.dataset.amvSyncState='';summary.append(glyph(icon),name,state);row.append(summary,detail);statusList.append(row);rows.set(key,{row,state,detail,message:'',at:0});
    }
    const links=element('div',undefined,'amv-sync-links'),loadoutLink=element('a','查看装备预设'),inventoryLink=button('物品查找',()=>{hide();window.dispatchEvent(new CustomEvent('aether-inventory-search',{detail:{character}}));});loadoutLink.target='_blank';loadoutLink.rel='noopener noreferrer';links.append(loadoutLink,inventoryLink);overview.append(links);
    const link=element('a','打开 Web 设备管理'),connectionSummary=element('div',undefined,'amv-sync-connection-info'),connectionName=element('strong'),input=element('textarea'),inputLabel=element('label','设备同步码'),choices=element('div',undefined,'amv-pin-choices'),modeTitle=element('h3','首次装备置顶处理'),modeHelp=element('p',undefined,'amv-sync-help'),scope=element('p','只影响装备置顶，其他数据自动合并。','amv-sync-help'),connect=button('连接并同步',bind),disconnect=button('断开本机',unbind),connectActions=element('div',undefined,'amv-sync-connect-actions'),connectionFeedback=element('p');
    link.target='_blank';link.rel='noopener noreferrer';link.href=DEFAULT_SERVER+'/admin/aether/sync';connectionName.dataset.amvSyncServer='';connectionSummary.append(connectionName,link);input.id='aetheros-device-code';input.rows=3;input.autocomplete='off';input.spellcheck=false;input.placeholder='粘贴 AETHEROS1. 开头的设备同步码';input.setAttribute('aria-label','设备同步码');inputLabel.htmlFor=input.id;inputLabel.className='amv-sync-label';connectionFeedback.dataset.amvSyncConnectionFeedback='';connectionFeedback.setAttribute('role','status');connectionFeedback.setAttribute('aria-live','polite');disconnect.className='amv-sync-danger';connect.className='amv-sync-primary';connectActions.append(connect,disconnect);
    for(const [value,label]of [['merge','合并本机与云端'],['local','本机已有角色为准'],['cloud','使用云端置顶']]){const option=button(label,()=>{mode=value;renderMode();});option.dataset.amvPinMode=value;choices.append(option);}
    connection.append(connectionSummary,inputLabel,input,modeTitle,choices,modeHelp,scope,connectionFeedback,connectActions);
    const manual=button('立即同步',()=>{paused=false;for(const event of ['aether-history-sync-now','aether-loadout-sync-now','aether-role-sync-now','aether-support-sync-now','aether-inventory-sync-now'])window.dispatchEvent(new Event(event));synchronize(true);}),footerHint=element('span','本机修改会自动同步','amv-sync-help');manual.className='amv-sync-primary';footer.append(footerHint,manual);card.append(head,tabs,body,footer);modal.append(card);document.body.append(modal);
    const style=element('style');style.textContent=`
      .amv-pin-modal[hidden],.amv-pin-card [hidden]{display:none!important}.amv-pin-modal{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:16px;background:#030817b3;box-sizing:border-box}.amv-pin-card,.amv-pin-card *{box-sizing:border-box}.amv-pin-card{display:flex;flex-direction:column;width:min(560px,100%);max-height:min(760px,calc(100dvh - 32px));min-width:0;min-height:0;overflow:hidden;border:1px solid #7890ae45;border-radius:16px;background:#101b2e;color:#e6edf9;box-shadow:0 16px 70px #0006;font:13px/1.6 system-ui}.amv-pin-card p{margin:0 0 12px;overflow-wrap:anywhere}.amv-pin-card button,.amv-pin-card textarea{font:inherit;margin:0;color:inherit}.amv-pin-card button{cursor:pointer;border:1px solid #7890ae38;border-radius:8px;background:#18273d;padding:8px 12px}.amv-pin-card button:disabled{opacity:.4;cursor:default}.amv-pin-card a{color:#a5dacf;text-decoration:none}.amv-pin-card a:hover{text-decoration:underline}.amv-pin-card :is(button,textarea,a,summary):focus-visible{outline:2px solid #83d5ca;outline-offset:2px}.amv-sync-head{display:flex;align-items:center;gap:12px;padding:20px 22px 16px;flex:none}.amv-sync-head>div{flex:1;min-width:0}.amv-sync-head h2{margin:0;font-size:18px;font-weight:600}.amv-sync-kicker{display:block;margin-top:2px;color:#8499b4;font-size:11px}.amv-sync-badge{font-size:11px;color:#8fabc4;white-space:nowrap}.amv-sync-badge[data-state=ok]{color:#8dd6c0}.amv-sync-badge[data-state=error]{color:#f0b77a}.amv-pin-card .amv-sync-close{width:30px;height:30px;display:grid;place-items:center;flex:none;padding:0;border-color:transparent;background:transparent;color:#a5b6ce;font-size:23px;line-height:1}.amv-sync-tabs{display:flex;flex:none;gap:12px;padding:0 22px;border-bottom:1px solid #7890ae26}.amv-pin-card .amv-sync-tabs button{flex:1;padding:11px 0;border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:#8fa5bf;font-size:12px}.amv-pin-card .amv-sync-tabs button[aria-selected=true]{border-bottom-color:#83d5ca;color:#b4ece0}.amv-sync-body{min-height:0;overflow:auto;overscroll-behavior:contain}.amv-sync-page{padding:20px 22px}.amv-sync-server{display:flex;align-items:center;gap:12px;padding-bottom:16px;margin-bottom:15px;border-bottom:1px solid #7890ae26}.amv-sync-server>.mdi{font-size:24px;color:#83d5ca}.amv-sync-server>div{flex:1;min-width:0}.amv-sync-server strong,.amv-sync-server span{display:block}.amv-sync-server strong{font-size:13px;font-weight:550}.amv-sync-server span{font-size:11px;color:#8fa5bf;overflow-wrap:anywhere}.amv-sync-server button{flex:none;font-size:11px;padding:6px 9px;background:transparent}.amv-pin-card [data-amv-sync-feedback]{font-size:11px;color:#9fb6cc}.amv-sync-status-row{border-bottom:1px solid #7890ae1f}.amv-sync-status-row summary{display:flex;align-items:center;gap:10px;list-style:none;padding:12px 0;cursor:pointer}.amv-sync-status-row summary::-webkit-details-marker{display:none}.amv-sync-status-row summary:after{content:'›';color:#667f9e;font-size:15px;line-height:1}.amv-sync-status-row[open] summary:after{transform:rotate(90deg)}.amv-sync-status-row summary>.mdi{color:#8ca9c4;width:20px;flex:none;text-align:center;font-size:17px}.amv-sync-name{flex:1;min-width:0;font-size:12px}.amv-sync-state{display:flex;align-items:center;gap:6px;flex:none;font-size:11px;color:#91a5bc}.amv-sync-state:before{content:'';width:5px;height:5px;border-radius:50%;background:currentColor}.amv-sync-status-row[data-state=ok] .amv-sync-state{color:#8dd6c0}.amv-sync-status-row[data-state=busy] .amv-sync-state{color:#88c6ee}.amv-sync-status-row[data-state=error] .amv-sync-state{color:#efba82}.amv-sync-status-row>p{padding:0 0 12px 30px;color:#8fa5bf;font-size:11px}.amv-sync-links{display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding-top:16px;font-size:11px}.amv-pin-card .amv-sync-links button{padding:0;border:0;border-radius:0;background:none;color:#a5dacf;font-size:11px}.amv-sync-footer{display:flex;align-items:center;gap:16px;flex:none;justify-content:space-between;padding:14px 22px;border-top:1px solid #7890ae26;background:#0d1728}.amv-pin-card .amv-sync-primary{color:#c1f4e8;background:#57bca523;border-color:#73ccbd5c}.amv-sync-help{color:#8fa5bf;font-size:11px}.amv-sync-connection-info{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding-bottom:17px;margin-bottom:17px;border-bottom:1px solid #7890ae26}.amv-sync-connection-info strong{min-width:0;overflow-wrap:anywhere;font-size:12px;font-weight:500}.amv-sync-connection-info a{font-size:11px}.amv-sync-label{display:block;margin:0 0 7px;font-size:12px}.amv-pin-card textarea{width:100%;display:block;resize:vertical;min-height:76px;max-height:150px;padding:10px 12px;border:1px solid #7890ae38;border-radius:8px;background:#0c1526;font-size:12px;overflow-wrap:anywhere}.amv-sync-page h3{font-size:12px;font-weight:500;margin:18px 0 9px}.amv-pin-choices{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-bottom:10px}.amv-pin-card .amv-pin-choices button{font-size:11px;padding:8px 6px;background:transparent}.amv-pin-card .amv-pin-choices button[aria-pressed=true]{color:#b4ece0;border-color:#73ccbd80;background:#57bca518}.amv-sync-connect-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:17px}.amv-pin-card .amv-sync-danger{margin-left:auto;color:#d79e9e;background:transparent;border-color:#c978782e}.amv-pin-card [data-amv-sync-connection-feedback]:empty{display:none}.amv-pin-card [data-amv-sync-connection-feedback]{color:#a5bacf;font-size:11px}.amv-history-bulk>strong{display:block;font-size:14px;font-weight:550;margin-bottom:8px}.amv-history-bulk>p{font-size:12px;color:#9fb2ca}.amv-pin-actions{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.amv-history-bulk [role=status]{white-space:pre-line;font-size:11px;color:#abd7ca}.amv-sync-body::-webkit-scrollbar{width:5px}.amv-sync-body::-webkit-scrollbar-thumb{border-radius:5px;background:#7890ae45}@media(max-width:420px){.amv-pin-modal{padding:10px}.amv-pin-card{max-height:calc(100dvh - 20px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));border-radius:12px}.amv-sync-head{padding:17px 16px 13px;gap:8px}.amv-sync-tabs{padding:0 16px;gap:8px}.amv-sync-page{padding:17px 16px}.amv-sync-footer{padding:12px 16px}.amv-pin-choices{grid-template-columns:1fr}.amv-pin-card .amv-pin-choices button{text-align:left;padding:9px 12px}.amv-sync-head h2{font-size:17px}}`;
    document.head.append(style);renderMode();selectTab('overview');
    function glyph(name){const icon=element('i',undefined,'mdi '+name);icon.setAttribute('aria-hidden','true');return icon;}
    function selectTab(id,focus=false){if(!pages.has(id))return;selectedTab=id;for(const [key,page]of pages){page.hidden=key!==id;const tab=tabButtons.get(key);tab.setAttribute('aria-selected',String(key===id));tab.tabIndex=key===id?0:-1;}footer.hidden=id!=='overview';body.scrollTop=0;if(focus)tabButtons.get(id).focus();}
    function renderMode(){for(const node of choices.children)node.setAttribute('aria-pressed',String(node.dataset.amvPinMode===mode));modeHelp.textContent={merge:'合并两边已有的装备置顶。',local:'以本机已有角色为准，覆盖云端对应角色的装备置顶。',cloud:'用云端装备置顶替换本机置顶。'}[mode];}
    function hide(){modal.hidden=true;returnFocus?.focus?.();}
    function stateFor(text,connected){if(!connected)return ['local','仅本机'];if(/失败|超时|暂不|无法|尚未更新|撤销|无效|离线|重置|不足/.test(text))return ['error','需检查'];if(!text||/等待|保留在本机|仅存本机|存于本机|仅保存在本机/.test(text))return ['waiting','等待同步'];if(text.includes('已同步'))return ['ok','已同步'];if(/正在|检查/.test(text))return ['busy','同步中'];return ['error','需检查'];}
    function renderRows(config){for(const [key,view]of rows){const text=key==='pins'?message:view.message,[state,label]=stateFor(key==='pins'&&busy?'正在同步':text,!!config&&(key==='pins'||config.initial===null));view.row.dataset.state=state;view.state.textContent=label;view.state.title=view.at&&state==='ok'?'最近同步 '+new Date(view.at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):text;view.detail.textContent=!config?'连接设备后自动合并同步。':text||'等待首次同步。';if(key==='inventory')view.detail.textContent+=' 库存来自手动读取的缓存，可在“物品查找”中重新读取。';}}
    function updateStatus(key,text){const config=load();rememberConnection(config);const view=rows.get(key);if(!view)return;view.message=String(text||'');if(view.message.includes('已同步'))view.at=Date.now();if(!modal.hidden)renderRows(config);}
    function rememberConnection(config){const identity=config?config.server+'|'+config.client_id:'';if(identity!==lastConnection){for(const view of rows.values()){view.message='';view.at=0;}lastConnection=identity;}}
    function render(){const config=load();rememberConnection(config);if(config&&message==='未连接云同步')message='已连接，等待同步';const pending=config?.pending.length||0;feedback.textContent=message+(pending?' · 待同步 '+pending+' 项':'');feedback.hidden=!busy&&!pending&&['置顶已同步','未连接云同步'].includes(message);connectionFeedback.textContent=config||message!=='未连接云同步'?message:'';manual.disabled=busy||!config;disconnect.disabled=busy||!config;disconnect.hidden=!config;connect.disabled=busy;input.disabled=busy;link.href=(config?.server||DEFAULT_SERVER)+'/admin/aether/sync';loadoutLink.hidden=!config;loadoutLink.href=(config?.server||DEFAULT_SERVER)+'/admin/aether?character_view=presets#aether-equipment';const host=config?new URL(config.server).host:'';serverTitle.textContent=config?'设备已连接':'尚未连接设备';serverName.textContent=config?host:'连接后可在电脑、手机与 iPad 共用数据';connectionName.textContent=config?'当前服务 · '+host:'尚未配置设备连接';manage.textContent=config?'管理连接':'连接设备';badge.textContent=config?(paused?'需检查':'已连接'):'未连接';badge.dataset.state=config?(paused?'error':'ok'):'local';footerHint.textContent=pending?'待同步 '+pending+' 项修改':config?'本机修改会自动同步':'连接后启用多设备同步';for(const node of document.querySelectorAll('[data-amv-pin-open]'))node.title='数据同步：'+message;if(!modal.hidden)renderRows(config);}
    tabs.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const ids=[...pages.keys()],index=ids.indexOf(event.target.closest('[role=tab]')?.dataset.amvSyncTab||selectedTab);selectTab(ids[event.key==='Home'?0:event.key==='End'?ids.length-1:(index+(event.key==='ArrowRight'?1:-1)+ids.length)%ids.length],true);});
    for(const [event,key]of [['aether-history-sync-status','history'],['aether-loadout-sync-status','loadouts'],['aether-role-sync-status','roles'],['aether-support-sync-status','support'],['aether-inventory-sync-status','inventory']])window.addEventListener(event,event=>updateStatus(key,typeof event.detail==='string'?event.detail:event.detail?.message));
    function schedule(delay=500){clearTimeout(timer);if(load()&&!paused)timer=setTimeout(()=>synchronize(),delay);}
    async function synchronize(force=false){if(busy||paused&&!force||!load())return;if(document.hidden&&!force){schedule(30000);return;}busy=true;render();try{await locked('network',async()=>{const sent=await locked('queue',()=>{const config=load();if(!config)return null;flush(config);return {server:config.server,token:config.token,client_id:config.client_id,initial:config.initial,operations:config.pending.slice(0,500)};});if(!sent)return;const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);let response,data;try{response=await fetch(sent.server+'/api/aetheros/pins/sync',{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',headers:{'Content-Type':'application/json','Authorization':'Bearer '+sent.token},body:JSON.stringify({client_id:sent.client_id,initial:sent.initial,operations:sent.operations}),signal:controller.signal});data=await response.json().catch(()=>({}));}finally{clearTimeout(timeout);}if(!response.ok){if([401,403,409,413,422].includes(response.status))paused=true;throw new Error(response.status===404?'同步服务尚未更新，请先更新 Mugen-Web':typeof data.detail==='string'?data.detail:'同步服务暂不可用');}if(data.version!==1||!Number.isSafeInteger(data.ack)||!Number.isSafeInteger(data.revision)||data.ack<0||data.revision<0||!data.characters||typeof data.characters!=='object'||Array.isArray(data.characters)||Object.values(data.characters).some(values=>!Array.isArray(values)||values.some(value=>typeof value!=='string')))throw new Error('同步响应无效，保留本机数据');await locked('queue',()=>{const config=load();if(!config||config.client_id!==sent.client_id||config.token!==sent.token)return;flush(config);config.pending=config.pending.filter(op=>op.seq>data.ack);config.initial=null;config.next_seq=Math.max(config.next_seq,data.ack);config.revision=data.revision;if(!save(config))throw new Error(message);apply(data,config);});message='置顶已同步';window.dispatchEvent(new Event('aether-history-sync-now'));if(sent.initial){window.dispatchEvent(new Event('aether-loadout-sync-now'));window.dispatchEvent(new Event('aether-role-sync-now'));window.dispatchEvent(new Event('aether-support-sync-now'));}});}catch(error){message=error.name==='AbortError'?'连接超时，置顶保留在本机':error instanceof TypeError?'暂时离线，置顶保留在本机':error.message||'暂时离线，置顶保留在本机';}finally{busy=false;render();const config=load();if(config&&!paused)schedule(config.pending.length?5000:30000);}}
    async function bind(){if(busy)return;if(!navigator.locks?.request){message='此浏览器缺少同步锁支持，请更新浏览器后连接';render();return;}let payload;try{const text=input.value.trim();if(!text.startsWith('AETHEROS1.'))throw new Error();payload=JSON.parse(atob(text.slice(10).replaceAll('-','+').replaceAll('_','/')));if(payload.version!==1||!validServer(payload.server)||!/^[A-Za-z0-9_-]{32,128}$/.test(payload.token))throw new Error();}catch{message='设备同步码格式不正确';render();return;}if(mode==='local'&&!confirm('将以本机已有角色的置顶为准覆盖云端对应角色，继续？'))return;if(load()&&!confirm('更换当前连接？本机置顶会保留，请确认首次同步方式。'))return;const config={version:1,server:payload.server,token:payload.token,client_id:random(),next_seq:0,pending:[],initial:{mode,characters:snapshots()},revision:0};paused=false;if(!save(config))return;input.value='';message='正在连接…';await synchronize(true);if(load()?.initial===null)selectTab('overview');}
    async function unbind(){if(!confirm('断开本机同步？本机数据会保留；未同步修改可在下次连接时合并。'))return;await locked('queue',()=>{localStorage.removeItem(KEY);});clearTimeout(timer);paused=false;message='已断开，本机数据保留';render();selectTab('connection');}
    window.addEventListener('aether-pin-change',event=>{const detail=event.detail,config=load();if(!config||!detail||typeof detail.character!=='string'||typeof detail.uuid!=='string'||typeof detail.pinned!=='boolean')return;try{const existing=drafts(config),order=Math.max(0,...existing.map(value=>value.order||0))+1;localStorage.setItem(DRAFT+config.client_id+':'+random(),JSON.stringify({character:detail.character,uuid:detail.uuid,pinned:detail.pinned,order}));locked('queue',()=>{const latest=load();if(latest?.client_id===config.client_id)flush(latest);}).then(()=>{render();schedule();}).catch(()=>{message='同步队列无法保存，请保留本机数据并重新连接';paused=true;render();});}catch{message='同步队列无法保存，请保留本机数据并重新连接';paused=true;render();}});
    window.addEventListener('aether-pins-settings',event=>{returnFocus=document.activeElement;character=event.detail?.character||sessionStorage.getItem(ACTIVE)||'';modal.hidden=false;render();selectTab(pages.has(event.detail?.tab)?event.detail.tab:load()?'overview':'connection');close.focus();});modal.addEventListener('click',event=>{if(event.target===modal)hide();});modal.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();hide();}if(event.key==='Tab'){const controls=[...card.querySelectorAll('a[href],button:not(:disabled),textarea:not(:disabled),summary')].filter(node=>node.getClientRects().length&&node.tabIndex!==-1),first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});window.addEventListener('online',()=>schedule(100));document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule(100);});window.addEventListener('storage',event=>{if(event.key===KEY)render();});render();schedule(1000);
  }
  function initScriptUpdates(){
    if(window.top!==window||window[Symbol.for('aether.script.updates')])return;window[Symbol.for('aether.script.updates')]=true;
    const UPDATE_DELAY=8000;
    const KEY='aether-script-updates-v1',DAY=86400000,HOUR=3600000,META='https://raw.githubusercontent.com/de3BDJMH/AetherOS/main/AetherOS.meta.js',INSTALL='https://raw.githubusercontent.com/de3BDJMH/AetherOS/main/AetherOS.user.js',RELEASES='https://github.com/de3BDJMH/AetherOS/releases';
    let checking=false,noticeVersion='',timer=null,cache={};
    function version(value){return typeof value==='string'&&/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value)?value:null;}
    function newer(value){if(!version(value))return false;const a=value.split('.').map(Number),b=SCRIPT_VERSION.split('.').map(Number);for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;}
    function read(){try{const value=JSON.parse(localStorage.getItem(KEY)||'null');if(value&&typeof value==='object'&&!Array.isArray(value))return value;}catch{}return cache;}
    function save(value){cache=value;try{localStorage.setItem(KEY,JSON.stringify(value));}catch{}}
    function recent(value,period){const now=Date.now();return Number.isFinite(value)&&value>=0&&value<=now&&now-value<period;}
    const style=element('style');style.textContent=`
      #aether-script-update{position:fixed;top:calc(64px + env(safe-area-inset-top,0px));right:16px;z-index:2147483646;width:min(330px,calc(100vw - 24px));box-sizing:border-box;padding:16px;border:1px solid #ffffff16;border-radius:13px;background:#242930f5;box-shadow:0 8px 28px #0005;color:#e7e9ed;font:13px/1.5 'Segoe UI',system-ui,sans-serif;color-scheme:dark;-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px)}#aether-script-update[hidden],#aether-script-update [hidden]{display:none!important}#aether-script-update strong{display:block;font-size:13px;font-weight:600}#aether-script-update p{margin:6px 0 13px;color:#a9b3bf;font-size:12px}#aether-script-update .asu-actions{display:flex;justify-content:flex-end;gap:8px}#aether-script-update button,#aether-script-update a{display:inline-flex;align-items:center;justify-content:center;margin:0;padding:5px 10px;border:1px solid #ffffff10;border-radius:6px;background:#ffffff07;color:#c6cfda;font:12px/1.5 'Segoe UI',system-ui,sans-serif;text-decoration:none;cursor:pointer}#aether-script-update a{background:#8ed4bf;border-color:transparent;color:#14221e}#aether-script-update button:hover{background:#ffffff10}#aether-script-update a:hover{background:#a4e0ce}#aether-script-update button:focus-visible,#aether-script-update a:focus-visible{outline:2px solid #92d8c6;outline-offset:2px}#aether-multiview .amv-script-version{margin-right:auto;align-self:center;font-size:10px;color:#969fab}#aether-multiview .amv-roles footer{gap:8px}@media(max-width:450px){#aether-script-update{top:calc(60px + env(safe-area-inset-top,0px));right:12px}}
    `;document.head.append(style);
    const notice=element('section'),title=element('strong'),description=element('p'),actions=element('div',undefined,'asu-actions'),link=element('a','更新脚本'),retry=button('重试',()=>check(true)),later=button('稍后',dismiss);notice.id='aether-script-update';notice.hidden=true;notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');link.target='_blank';link.rel='noopener noreferrer';link.dataset.asuInstall='';retry.dataset.asuRetry='';later.dataset.asuLater='';actions.append(link,retry,later);notice.append(title,description,actions);document.body.append(notice);
    function dismiss(){if(noticeVersion){const value=read();save({...value,dismissedVersion:noticeVersion,dismissedAt:Date.now()});}notice.hidden=true;}
    function show(kind,value){noticeVersion=kind==='update'?value:'';notice.dataset.state=kind;link.hidden=kind!=='update'&&kind!=='error';retry.hidden=kind!=='error';later.textContent=kind==='update'?'稍后':'关闭';link.textContent=kind==='update'?'更新脚本':'查看 GitHub';link.href=kind==='update'?INSTALL+'?v='+encodeURIComponent(value):RELEASES;if(kind==='update'){title.textContent='AetherOS 有新版本 v'+value;description.textContent='当前 v'+SCRIPT_VERSION+'，点击安装更新后刷新游戏官网。';}else if(kind==='checking'){title.textContent='正在检查更新…';description.textContent='从 GitHub 读取版本信息。';}else if(kind==='latest'){title.textContent='已是最新版本 v'+SCRIPT_VERSION;description.textContent='当前脚本无需更新。';}else{title.textContent='暂时无法检查更新';description.textContent='未能连接 GitHub，请稍后重试，游戏功能不受影响。';}notice.hidden=false;}
    function offer(value,force=false){if(!newer(value.latest))return;if(!force&&value.dismissedVersion===value.latest&&recent(value.dismissedAt,DAY))return;show('update',value.latest);}
    async function check(force=false){if(checking||document.hidden&&!force)return;cache=read();offer(cache,force);if(!force&&(recent(cache.checkedAt,DAY)||recent(cache.lastAttempt,HOUR)))return;checking=true;save({...read(),lastAttempt:Date.now()});if(force)show('checking');const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
      try{
        // 只读取公开版本文件，不携带游戏凭证，也不下载或执行远程代码。
        const response=await fetch(META+'?check='+Date.now(),{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('版本读取失败');const text=await response.text();if(text.length>32768||!/^\/\/\s*@namespace\s+mugen\.aether\.multiview\s*$/m.test(text))throw new Error('版本文件不匹配');const latest=version(text.match(/^\/\/\s*@version\s+(\S+)\s*$/m)?.[1]);if(!latest)throw new Error('版本格式无效');save({...read(),checkedAt:Date.now(),latest});if(newer(latest))offer(read(),force);else if(force)show('latest');
      }catch{if(force)show('error');}finally{clearTimeout(timeout);checking=false;}
    }
    function schedule(){clearTimeout(timer);timer=setTimeout(()=>check(),UPDATE_DELAY);}
    window.addEventListener('aether-userscript-check-updates',()=>check(true));window.addEventListener('storage',event=>{if(event.key===KEY){cache=read();offer(cache);}});document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});window.addEventListener('pageshow',schedule);cache=read();offer(cache);schedule();
  }
  const SAVED_GEAR={weapon:'武器',top:'上衣',bottom:'下装',gloves:'手部',shoes:'鞋子',accessory:'饰品'};
  const SAVED_SKILLS={addon:'附加技能',custom:'自定义技能',aether:'以太爆发'};
  const SAVED_PRISMS={core:'纯净',red:'红色',blue:'蓝色',green:'绿色'};
  const PRESET_ELEMENTS={fire:['mdi-fire','#ff7a5c'],water:['mdi-water','#62d1ff'],lightning:['mdi-lightning-bolt','#ffd451'],earth:['mdi-terrain','#9bd36e'],wind:['mdi-weather-windy','#6eeedc'],light:['mdi-white-balance-sunny','#f9ffb5'],dark:['mdi-moon-waning-crescent','#a98bff']};

  function presetSkillElement(entry,skill=entry?.skill){
    let best='',threshold=0;
    for(const [element,value] of Object.entries(entry?.requirement||{}))if(Object.hasOwn(PRESET_ELEMENTS,element)&&Number.isFinite(value)&&value>threshold){best=element;threshold=value;}
    return best||(Object.hasOwn(PRESET_ELEMENTS,skill?.damage_type)?skill.damage_type:'');
  }

  function loadoutItemIcon(icon){
    const source=typeof icon==='string'?icon:icon?.url;if(!source)return null;
    try{
      const url=new URL(source,ORIGIN);
      if(url.username||url.password||url.protocol!=='https:')return null;
      const local=url.origin===ORIGIN&&url.pathname.startsWith('/api/aether/assets/');
      const cdn=url.origin==='https://aliyun-static.diving-fish.com'&&url.pathname.startsWith('/aether/assets/');
      if(!local&&!cdn)return null;
      const number=(value,fallback,min,max)=>Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
      return {url:url.href,scale:number(icon?.scale,1,.1,4),x:number(icon?.offset_x??icon?.x,0,-100,100),y:number(icon?.offset_y??icon?.y,0,-100,100),rotate:number(icon?.rotate,0,-360,360),hue:number(icon?.hue,0,-360,360),brightness:number(icon?.brightness,1,0,3)};
    }catch{return null;}
  }

  function captureCustomLoadout(status,prism){
    if(!Array.isArray(status?.equipment_slots)||!Array.isArray(status?.skills?.slots)||!prism?.equipped)throw Error('官网配装数据不完整');
    const equipment={},skills={},spectra={};
    for(const slot of Object.keys(SAVED_GEAR)){
      const row=status.equipment_slots.find(value=>value.slot===slot);
      if(!row||row.item&&typeof row.item.uuid!=='string')throw Error('无法读取'+SAVED_GEAR[slot]);
      equipment[slot]=row.item?{uuid:row.item.uuid,name:row.item.name||row.item.uuid,icon:loadoutItemIcon(row.item.icon)}:null;
    }
    for(const slot of Object.keys(SAVED_SKILLS)){
      const row=status.skills.slots.find(value=>value.slot===slot),choices=status.skills.available?.[slot];
      if(!row||!choices||!Object.hasOwn(choices,'selected'))throw Error('无法读取'+SAVED_SKILLS[slot]);
      const code=choices.selected;
      if(code!==null&&typeof code!=='string')throw Error(SAVED_SKILLS[slot]+'编号无效');
      const option=choices.options?.find(value=>value.skill_code===code),skill=option?.skill||row.skill;
      skills[slot]=code?{code,name:skill?.name||code,element:presetSkillElement(option,skill)}:null;
    }
    for(const color of Object.keys(SAVED_PRISMS)){
      const rows=prism.equipped[color];
      if(!Array.isArray(rows)||rows.some(row=>typeof row?.talent_id!=='string'||!row.talent_id))throw Error('无法读取'+SAVED_PRISMS[color]+'光谱');
      spectra[color]=rows.map(row=>({id:row.talent_id,name:row.name||row.talent_id}));
    }
    return {equipment,skills,spectra};
  }

  function prismIds(build,color){return build.spectra[color].map(row=>row.id);}
  async function applyCustomLoadout(target,{read,write,progress=()=>{}}){
    let world=await read(),current=world.build,changes=0;
    const inventory=new Map();
    for(const item of [...(world.status.backpack?.equipment||[]),...world.status.equipment_slots.map(row=>row.item)])if(item?.uuid)inventory.set(item.uuid,item);
    for(const [slot,label] of Object.entries(SAVED_GEAR)){
      const desired=target.equipment[slot];if(!desired)continue;
      const item=inventory.get(desired.uuid);
      if(!item||item.broken||item.slot!==slot)throw Error(label+'「'+desired.name+'」已不可用');
    }
    for(const [color,label] of Object.entries(SAVED_PRISMS)){
      const ids=prismIds(target,color),owned=new Set([...(world.prism.owned?.[color]||[]),...(world.prism.equipped[color]||[])].map(row=>row.talent_id));
      if(ids.length>(world.prism.slots?.[color]??0)||ids.some(id=>!owned.has(id)))throw Error(label+'光谱有未解锁的槽位或已不可用的光谱');
    }
    const send=async(label,path,body)=>{progress(label);try{await write(path,body);changes++;}catch(error){throw Error(label+'失败：'+error.message);}};
    for(const [slot,label] of Object.entries(SAVED_GEAR)){
      const desired=target.equipment[slot];
      if(desired?.uuid===current.equipment[slot]?.uuid)continue;
      if(desired)await send('穿戴'+label,'/status/equip',{slot,entry_uuid:desired.uuid});
      else await send('卸下'+label,'/status/unequip',{slot});
    }
    if(changes){world=await read();current=world.build;}
    const gearChanges=changes;
    const prismChanges=[];
    for(const [color,label] of Object.entries(SAVED_PRISMS)){
      const expected=prismIds(target,color),actual=prismIds(current,color);let prefix=0;
      while(prefix<expected.length&&expected[prefix]===actual[prefix])prefix++;
      if(prefix===expected.length&&prefix===actual.length)continue;
      const owned=new Map((world.prism.owned?.[color]||[]).map(row=>[row.talent_id,row]));
      for(const row of world.prism.equipped[color])if(!owned.has(row.talent_id))owned.set(row.talent_id,row);
      if(expected.length>(world.prism.slots?.[color]??0)||expected.slice(prefix).some(id=>!owned.has(id)||owned.get(id).requirement_met===false))throw Error(label+'光谱装填条件未满足');
      prismChanges.push({color,label,expected,actual,prefix});
    }
    for(const {color,label,expected,actual,prefix} of prismChanges){
      for(let index=actual.length-1;index>=prefix;index--)await send('卸下'+label+'光谱第 '+(index+1)+' 格','/prism/uninstall',{spectrum:color,index});
      for(const talent_id of expected.slice(prefix))await send('装填'+label+'光谱','/prism/install',{spectrum:color,talent_id});
    }
    if(changes!==gearChanges){world=await read();current=world.build;}
    for(const [slot,label] of Object.entries(SAVED_SKILLS)){
      const desired=target.skills[slot];
      if(desired?.code===current.skills[slot]?.code)continue;
      const option=world.status.skills.available[slot]?.options?.find(row=>row.skill_code===desired?.code);
      if(desired&&(!option||option.can_equip===false))throw Error(label+'「'+desired.name+'」当前不能装配');
      await send('切换'+label,'/status/skills',{slot,skill_code:desired?.code??null});
    }
    if(changes)current=(await read()).build;
    for(const [slot,label] of Object.entries(SAVED_GEAR))if(current.equipment[slot]?.uuid!==target.equipment[slot]?.uuid)throw Error(label+'核对失败');
    for(const [slot,label] of Object.entries(SAVED_SKILLS))if(current.skills[slot]?.code!==target.skills[slot]?.code)throw Error(label+'核对失败');
    for(const [color,label] of Object.entries(SAVED_PRISMS))if(JSON.stringify(prismIds(current,color))!==JSON.stringify(prismIds(target,color)))throw Error(label+'光谱顺序核对失败');
    return changes;
  }

  const LEGACY_LOADOUTS='aether-custom-loadouts-v1:', CLOUD_LOADOUTS='aether-custom-loadouts-v2:';
  function validLoadout(row){
    const isId=value=>typeof value==='string'&&value.length>0;
    if(!isId(row?.name))return false;
    if(row.empty===true)return true;
    if(!row.equipment||!row.skills||!row.spectra)return false;
    const slotsValid=(slots,stored,id)=>Object.keys(slots).every(slot=>stored[slot]===null||isId(stored[slot]?.[id])&&isId(stored[slot]?.name));
    return slotsValid(SAVED_GEAR,row.equipment,'uuid')&&slotsValid(SAVED_SKILLS,row.skills,'code')&&Object.keys(SAVED_PRISMS).every(color=>Array.isArray(row.spectra[color])&&row.spectra[color].every(item=>isId(item?.id)&&isId(item?.name)));
  }
  const isLoadoutStamp=value=>Number.isSafeInteger(value)&&value>=0;
  function validLoadoutChange(row){
    return typeof row?.character==='string'&&row.character.length>0&&typeof row.id==='string'&&row.id.length>0&&
      isLoadoutStamp(row.stamp)&&isLoadoutStamp(row.order)&&/^[0-9a-f-]{36}$/.test(row.change_id)&&
      (row.preset===null||validLoadout(row.preset));
  }
  function loadoutDocument(character){
    const raw=localStorage.getItem(CLOUD_LOADOUTS+character);
    if(raw!==null){
      const rows=JSON.parse(raw);
      if(!Array.isArray(rows)||!rows.every(row=>validLoadoutChange(row)&&row.character===character))throw Error('本机预设格式无效');
      return rows;
    }
    const legacy=JSON.parse(localStorage.getItem(LEGACY_LOADOUTS+character)||'[]');
    if(!Array.isArray(legacy)||!legacy.every(row=>typeof row?.id==='string'&&row.id&&validLoadout(row)))throw Error('本机预设格式无效');
    return legacy.map(({id,updatedAt,...preset},order)=>({
      character,id,order,preset,stamp:isLoadoutStamp(updatedAt)?updatedAt:0,
      change_id:'00000000-0000-0000-0000-000000000000',dirty:true,
    }));
  }
  const orderedLoadouts=rows=>rows.filter(row=>row.preset).sort((a,b)=>a.order-b.order||(a.id<b.id?-1:1));

  function initLoadoutSync(){
    if(window.top!==window)return;
    const configKey='aether-pin-sync-v1',stateKey='aether-custom-loadout-sync-v1';
    let timer,busy=false,requested=false,offline=false;
    function config(){
      try{
        const row=JSON.parse(localStorage.getItem(configKey)||'null'),url=new URL(row.server);
        if(row.version!==1||row.initial!==null||url.origin!==row.server||
          !(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))||
          !/^[A-Za-z0-9_-]{32,128}$/.test(row.token)||!/^[A-Za-z0-9_-]{20,80}$/.test(row.client_id))return null;
        return row;
      }catch{return null;}
    }
    function status(message,server=''){
      window[Symbol.for('aether.loadout.sync.status')]={message,server};
      window.dispatchEvent(new CustomEvent('aether-loadout-sync-status',{detail:{message,server}}));
    }
    function schedule(delay=700){
      clearTimeout(timer);
      timer=setTimeout(synchronize,delay);
    }
    function characters(){
      return new Set(Array.from({length:localStorage.length},(_,index)=>localStorage.key(index)).flatMap(key=>{
        const prefix=[CLOUD_LOADOUTS,LEGACY_LOADOUTS].find(value=>key?.startsWith(value));
        return prefix?[key.slice(prefix.length)]:[];
      }).filter(Boolean));
    }
    function storeChanges(changes){
      const byCharacter=new Map();
      for(const row of changes){
        if(!byCharacter.has(row.character))byCharacter.set(row.character,[]);
        byCharacter.get(row.character).push(row);
      }
      for(const [character,incoming] of byCharacter){
        const rows=new Map(loadoutDocument(character).map(row=>[row.id,row]));
        for(const remote of incoming){
          const local=rows.get(remote.id);
          if(local&&(local.stamp>remote.stamp||local.stamp===remote.stamp&&local.change_id>remote.change_id))continue;
          if(local&&local.change_id===remote.change_id&&local.stamp===remote.stamp&&!local.dirty)continue;
          rows.set(remote.id,{...remote,dirty:false});
        }
        const key=CLOUD_LOADOUTS+character,value=JSON.stringify([...rows.values()]);
        if(localStorage.getItem(key)!==value){
          localStorage.setItem(key,value);
          window.dispatchEvent(new StorageEvent('storage',{key,newValue:value}));
        }
      }
    }
    async function exchange(current){
      let progress;
      try{progress=JSON.parse(localStorage.getItem(stateKey)||'null');}catch{}
      const names=characters();
      if(progress?.server!==current.server||!isLoadoutStamp(progress.cursor)){
        for(const character of names){
          const rows=loadoutDocument(character);
          localStorage.setItem(CLOUD_LOADOUTS+character,JSON.stringify(rows.map(row=>({...row,dirty:true}))));
        }
        progress={server:current.server,cursor:0};
        localStorage.setItem(stateKey,JSON.stringify(progress));
      }
      const changes=[];
      let bytes=0,waiting=false;
      for(const character of names){
        const rows=loadoutDocument(character);
        for(const {dirty,...change} of rows){
          if(!dirty)continue;
          const size=new TextEncoder().encode(JSON.stringify(change)).length;
          if(changes.length===40||bytes+size>600000){waiting=true;break;}
          changes.push(change);bytes+=size;
        }
      }
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
      let response,data;
      try{
        response=await fetch(current.server+'/api/aetheros/custom-loadouts/sync',{
          method:'POST',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',
          headers:{'Content-Type':'application/json',Authorization:'Bearer '+current.token},
          body:JSON.stringify({client_id:current.client_id,cursor:progress.cursor,changes}),signal:controller.signal,
        });
        data=await response.json().catch(()=>({}));
      }finally{clearTimeout(timeout);}
      if(!response.ok)throw Error(response.status===404?'Web 尚未更新，预设保留在本机':typeof data.detail==='string'?data.detail:'装备预设同步暂不可用');
      if(data.version!==1||!isLoadoutStamp(data.cursor)||typeof data.has_more!=='boolean'||
        !Array.isArray(data.changes)||data.changes.length>40||!data.changes.every(validLoadoutChange)||
        !Array.isArray(data.accepted)||data.accepted.length!==changes.length||
        !data.accepted.every((row,index)=>validLoadoutChange(row)&&row.character===changes[index].character&&row.id===changes[index].id))throw Error('装备预设同步响应无效');
      const active=config();
      if(active?.server!==current.server||active?.token!==current.token||active?.client_id!==current.client_id)return;
      storeChanges([...data.accepted,...data.changes]);
      localStorage.setItem(stateKey,JSON.stringify({server:current.server,cursor:data.cursor}));
      status('装备预设已同步',current.server);
      requested ||= waiting||data.has_more;
    }
    async function synchronize(){
      if(busy){requested=true;return;}
      const current=config();
      if(!current){status('装备预设保留在本机，连接云同步后自动上传');return;}
      if(document.hidden){schedule(60000);return;}
      busy=true;requested=false;
      try{
        await navigator.locks.request('aether-loadout-sync',async()=>{
          if(config()?.token===current.token)await exchange(current);
        });
        offline=false;
      }catch(error){
        offline=true;
        status((error.name==='AbortError'||error instanceof TypeError?'装备预设暂时无法连接 Web':error.message)+'，本机数据已保留',current.server);
      }finally{
        busy=false;schedule(!offline&&requested?700:60000);
      }
    }
    window.addEventListener('aether-loadout-change',()=>schedule());
    window.addEventListener('aether-loadout-sync-now',()=>schedule(0));
    window.addEventListener('storage',event=>{if(event.key===configKey||event.key?.startsWith(CLOUD_LOADOUTS))schedule();});
    window.addEventListener('online',()=>schedule(0));
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
    status(config()?'装备预设等待同步':'装备预设保留在本机，连接云同步后自动上传');
    schedule(1500);
  }

  function initCustomLoadouts(){
    const guard=Symbol.for('aether.custom.loadouts');if(window[guard])return;window[guard]=true;
    const role=()=>sessionStorage.getItem(ACTIVE)?.trim()||'';
    const load=who=>orderedLoadouts(loadoutDocument(who)).map(row=>({...row.preset,id:row.id,updatedAt:row.stamp}));
    function save(who,id,transform){
      const records=loadoutDocument(who),rows=orderedLoadouts(records),old=rows.find(row=>row.id===id);
      if(id&&!old)throw Error('此预设已在另一个窗口修改，请重新打开');
      if(!old&&rows.length>=50)throw Error('每个角色最多保存 50 套');
      const next=transform(old?{...old.preset,id:old.id,updatedAt:old.stamp}:undefined);
      const {id:identifier,updatedAt,...preset}=next||old||{};
      const stamp=Math.max(Date.now(),(old?.stamp??0)+1);
      const order=old?.order??Math.max(Date.now(),(rows.at(-1)?.order??0)+1);
      const change={character:who,id:identifier,stamp,order,change_id:crypto.randomUUID(),preset:next?preset:null,dirty:true};
      localStorage.setItem(CLOUD_LOADOUTS+who,JSON.stringify([...records.filter(row=>row.id!==identifier),change]));
      window.dispatchEvent(new Event('aether-loadout-change'));
    }
    async function request(who,path,body){
      if(role()!==who)throw Error('当前角色已切换');
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
      try{
        const url=new URL('/api/aether'+path,ORIGIN);url.searchParams.set('_aether_character',who);
        const response=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:controller.signal});
        const payload=await response.json().catch(()=>null);
        if(!response.ok||payload?.code!==0)throw Error(payload?.message||'官网请求失败（HTTP '+response.status+'）');
        return payload.data;
      }catch(error){if(error.name==='AbortError')throw Error('官网响应超时，请重新读取当前配装');throw error;}
      finally{clearTimeout(timeout);}
    }
    async function read(who){
      const [status,prism]=await Promise.all([request(who,'/status'),request(who,'/prism')]);
      if(role()!==who)throw Error('当前角色已切换');
      return {status,prism,build:captureCustomLoadout(status,prism)};
    }
    async function lock(who,work){
      if(navigator.locks?.request)return navigator.locks.request('aether-custom-loadout:'+who,{ifAvailable:true},locked=>{if(!locked)throw Error('该角色在其他窗口有配装操作');return work();});
      return work();
    }
    function refresh(who){
      if(role()!==who)return;
      const stores=document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$pinia?._s;
      Promise.allSettled([stores?.get('player')?.fetchStatus?.(),stores?.get('prism')?.fetch?.()]);
    }
    let catalog=null,catalogPending=null;
    const skillNames=new Map();
    function indexName(map,name,element){
      if(!name||!element)return;
      map.set(name,map.has(name)&&map.get(name)!==element?'':element);
    }
    async function skillCatalog(who){
      if(catalog)return catalog;
      if(!catalogPending)catalogPending=request(who,'/skills').then(data=>{
        if(!Array.isArray(data))throw Error('技能图鉴格式无效');
        catalog=new Map();for(const row of data){const value=presetSkillElement(null,row);if(!value)continue;catalog.set(row.name,value);indexName(skillNames,row.display_name,value);}
        return catalog;
      }).finally(()=>{catalogPending=null;});
      return catalogPending;
    }
    const style=element('style');style.textContent=`
      .aosp-loadout-layout{--aosp-card-height:108px}.aosp-loadout-head,.aosp-loadout-switch{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.aosp-loadout-head{grid-column:1/-1;grid-row:2;font-size:.8rem;font-weight:650}.aosp-loadout-switch{display:none}.aosp-loadout-head span{padding:0 4px}.aosp-loadouts{min-width:0}.aosp-loadout-card,.aosp-loadout-add{min-height:var(--aosp-card-height);box-sizing:border-box}.aosp-loadout-card .preset-name{min-width:0;overflow-wrap:anywhere}.aosp-loadout-card .preset-name-text{overflow-wrap:anywhere}.aosp-loadout-badge{font-size:.65rem;color:var(--accent,#82dbd1);white-space:nowrap}.aosp-loadout-list{display:flex;flex-direction:column;gap:.75rem}.aosp-loadout-list>.preset-card,.aosp-loadout-layout>.presets-list>.preset-card{flex:none}.aosp-loadout-add{display:grid;place-content:center;justify-items:center;gap:4px;width:100%;border-style:dashed!important;text-align:center;color:var(--accent,#82dbd1);cursor:pointer}.aosp-loadout-add strong{font-size:1.4rem;line-height:1}.aosp-loadout-form{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}.aosp-loadout-form input{flex:1 1 10rem;min-width:0;padding:5px 8px;border:1px solid #8ba9d350;border-radius:6px;color:inherit;font:inherit}.aosp-loadout-feedback{margin:0 0 7px;overflow-wrap:anywhere}.aosp-loadout-feedback:empty{display:none}.aosp-loadout-feedback.is-error{color:#ff9aa4}.aosp-loadouts [hidden]{display:none!important}.aosp-loadout-art{display:inline-flex;flex:0 0 30px;width:30px;height:30px;align-items:center;justify-content:center;overflow:hidden}.aosp-loadout-art img{display:block;width:30px;height:30px;max-width:none;object-fit:contain}.aosp-loadout-details{margin-bottom:.5rem;font-size:.73rem;overflow-wrap:anywhere}.aosp-loadout-details summary{cursor:pointer}
      @media(min-width:861px){.v-overlay__content:has(.aosp-loadout-layout){max-width:min(1040px,calc(100vw - 48px))!important}.aosp-loadout-layout{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:auto auto minmax(0,1fr);height:min(66vh,680px);height:min(66dvh,680px);box-sizing:border-box;overflow:hidden!important;gap:10px 14px}.aosp-loadout-layout>.ae-dialog__hint{grid-row:1;grid-column:1/-1}.aosp-loadout-layout>:is(.presets-loading,.presets-list){grid-column:1;grid-row:3}.aosp-loadout-layout>.aosp-loadouts{grid-column:2;grid-row:3}.aosp-loadout-layout>:is(.presets-list,.aosp-loadouts){min-height:0;min-width:0;overflow-y:auto;overscroll-behavior-y:contain;padding-inline-end:5px}}
      @media(max-width:860px){.aosp-loadout-head{display:none}.aosp-loadout-switch{display:grid;gap:7px;margin-bottom:9px}.aosp-loadout-switch button[aria-pressed=true]{color:var(--accent,#82dbd1);border-color:currentColor}.aosp-loadout-layout[data-aosp-tab=official]>.aosp-loadouts,.aosp-loadout-layout[data-aosp-tab=custom]>:not(.aosp-loadout-switch,.aosp-loadouts){display:none!important}}
      .aosp-loadout-layout .aosp-skill-chip{display:inline-flex;align-items:center;gap:.3rem;color:var(--el-color);border-color:color-mix(in srgb,var(--el-color) 40%,transparent);background:color-mix(in srgb,var(--el-color) 12%,transparent)}.aosp-loadout-layout .aosp-skill-chip i{font-size:.83rem;line-height:1}.aosp-loadout-layout .preset-skill-chip[hidden]{display:none!important}
    `;document.head.append(style);
    function mount(dialog,body){
      const scopes=body.getAttributeNames().filter(attr=>/^data-v-[\da-f]+$/i.test(attr));
      const scoped=node=>{scopes.forEach(attr=>node.setAttribute(attr,''));return node;};
      const native=(tag,text,classes)=>scoped(element(tag,text,classes));
      function action(text,icon,handler,classes=''){
        const node=scoped(button('',handler)),glyph=element('i',undefined,'mdi '+icon);glyph.setAttribute('aria-hidden','true');node.className='ae-btn '+classes;node.append(glyph,element('span',text));return node;
      }
      const section=element('section',undefined,'aosp-loadouts'),head=element('div',undefined,'aosp-loadout-head'),tabs=element('nav',undefined,'aosp-loadout-switch'),form=element('form',undefined,'aosp-loadout-form'),input=element('input'),submit=native('button','保存','ae-btn ae-btn--primary'),list=native('div',undefined,'presets-list aosp-loadout-list'),feedback=element('p',undefined,'aosp-loadout-feedback');
      let busy=false,editor=null,character=role(),metadataChecked=false,metadataPending=false,catalogChecked=false,scrollToNew=false;
      let icons=new Map(),skillsByName=new Map(),skillsByCode=new Map();
      body.classList.add('aosp-loadout-layout');head.append(element('span','官方预设'),element('span','自定义预设'));tabs.setAttribute('aria-label','装备预设分类');section.setAttribute('aria-label','自定义预设');
      const official=action('官方预设','mdi-bookmark-multiple-outline',()=>selectTab('official')),custom=action('自定义预设','mdi-bookmark-plus-outline',()=>selectTab('custom'));
      function selectTab(value){body.dataset.aospTab=value;official.setAttribute('aria-pressed',String(value==='official'));custom.setAttribute('aria-pressed',String(value==='custom'));if(value==='custom'&&!busy)draw();}
      tabs.append(official,custom);selectTab('official');input.maxLength=60;input.required=true;input.setAttribute('aria-label','自定义预设名称');submit.type='submit';form.hidden=true;
      form.append(input,submit,action('取消','mdi-close',()=>{editor=null;form.hidden=true;}));feedback.setAttribute('role','status');section.append(form,feedback,list);body.prepend(tabs,head);body.append(section);
      function message(value,error=false){feedback.textContent=value;feedback.classList.toggle('is-error',error);}
      function edit(row){editor=row;form.hidden=false;input.value=row.name;input.focus();input.select();}
      function collectMetadata(status){
        const items=[...(status?.backpack?.equipment||[]),...(status?.equipment_slots||[]).map(row=>row.item)];
        for(const item of items){const art=loadoutItemIcon(item?.icon);if(item?.uuid&&art)icons.set(item.uuid,art);}
        for(const group of Object.values(status?.skills?.available||{}))for(const option of group?.options||[]){
          const value=presetSkillElement(option);if(!value)continue;skillsByCode.set(option.skill_code,value);indexName(skillsByName,option.skill?.name,value);
        }
      }
      function skillElement(skill){return (Object.hasOwn(PRESET_ELEMENTS,skill.element)?skill.element:'')||skillsByCode.get(skill.code)||skillsByName.get(skill.name)||catalog?.get(skill.code)||skillNames.get(skill.name)||'';}
      function paintSkill(chip,skill){
        const [icon,color]=PRESET_ELEMENTS[skillElement(skill)]||['mdi-auto-fix','#9fb7ff'],stamp=JSON.stringify([skill.name,icon,color]);
        if(chip.dataset.aospPaint===stamp&&chip.querySelector('i'))return;
        const glyph=element('i',undefined,'mdi '+icon);glyph.setAttribute('aria-hidden','true');chip.dataset.aospPaint=stamp;chip.classList.add('aosp-skill-chip');chip.style.setProperty('--el-color',color);chip.replaceChildren(glyph,document.createTextNode(skill.name));
      }
      function paintOfficial(){
        const skills=[];
        for(const chip of body.querySelectorAll(':scope > .presets-list .preset-skill-chip')){
          const match=chip.textContent.trim().match(/^(?:附加|自定义|以太)\s*[:：]\s*(.+)$/);
          if(match)chip.dataset.aospSkillName=match[1];
          const name=chip.dataset.aospSkillName;if(!name)continue;
          chip.hidden=name==='无';if(chip.hidden)continue;
          const skill={name};skills.push(skill);paintSkill(chip,skill);
        }
        return skills;
      }
      function restoreMetadata(rows){
        if(!character||metadataPending)return;
        const visible=section.getClientRects().length>0;
        const needsIcon=visible&&rows.some(row=>Object.values(row.equipment||{}).some(item=>item&&!loadoutItemIcon(item.icon)&&!icons.has(item.uuid)));
        const skills=[...paintOfficial(),...(visible?rows.flatMap(row=>Object.values(row.skills||{})).filter(Boolean):[])];
        const needsSkills=skills.some(skill=>!skillElement(skill));
        if((metadataChecked||!needsIcon&&!needsSkills)&&(catalogChecked||catalog||!needsSkills))return;
        const who=character;
        metadataPending=true;
        (async()=>{
          if(!metadataChecked&&(needsIcon||needsSkills)){
            metadataChecked=true;
            const status=await request(who,'/status').catch(()=>null);
            if(character===who&&role()===who)collectMetadata(status);
          }
          if(character===who&&role()===who&&!catalogChecked&&!catalog&&skills.some(skill=>!skillElement(skill))){catalogChecked=true;await skillCatalog(who).catch(()=>{});}
        })().finally(()=>{
          if(character!==who)return;
          metadataPending=false;if(role()===who&&section.isConnected&&!busy&&!editor)draw();
        });
      }
      function itemArt(item,key){
        const fallback=()=>native('span',undefined,'preset-equip-empty mdi '+(item?GEAR_SLOTS[key][1]:'mdi-minus'));
        const art=item&&(loadoutItemIcon(item.icon)||icons.get(item.uuid));if(!art)return fallback();
        const box=element('span',undefined,'aosp-loadout-art'),img=element('img');
        img.alt='';img.draggable=false;img.style.transform=`translate(${art.x}px,${art.y}px) rotate(${art.rotate}deg) scale(${art.scale})`;img.style.filter=`hue-rotate(${art.hue}deg) brightness(${art.brightness})`;
        img.addEventListener('error',()=>box.replaceWith(fallback()),{once:true});box.append(img);img.src=art.url;return box;
      }
      function draw(){
        list.replaceChildren();
        if(!character){message('请先在官网选择角色');return;}
        let rows;try{rows=load(character);}catch(error){message(error.message,true);return;}
        for(const row of rows){
          const card=native('article',undefined,'preset-card aosp-loadout-card'+(row.empty?' preset-card--empty':'')),top=native('div',undefined,'preset-card-top'),name=native('div',undefined,'preset-name'),actions=native('div',undefined,'preset-actions'),details=element('details',undefined,'aosp-loadout-details');
          name.append(native('strong',row.name,'preset-name-text'));if(row.empty)name.append(native('small','空预设','preset-name-empty'));
          top.append(name,element('small','自定义','aosp-loadout-badge'));
          const apply=action('应用','mdi-check',()=>run(async who=>{
            if(!confirm('应用「'+row.name+'」？这会更换 '+who+' 的当前配装。'))return;
            message('正在核对 '+who+' 的配装…');
            let attempted=false;
            try{
              const count=await applyCustomLoadout(row,{read:()=>read(who),write:(path,data)=>{attempted=true;return request(who,path,data);},progress:label=>message(label+'…')});
              message(count?'已应用并核对「'+row.name+'」':'当前配装与「'+row.name+'」一致');
            }catch(error){if(attempted)error.message+='。可能已完成部分切换，再次应用将从实际配装继续';throw error;}
            finally{if(attempted)refresh(who);}
          }),'ae-btn--primary');
          apply.disabled=!!row.empty;
          actions.append(apply,action('保存','mdi-content-save',()=>{if(row.empty||confirm('用当前配装覆盖「'+row.name+'」？'))run(who=>capture(who,row.id,row.name));}),action('改名','mdi-pencil',()=>edit(row)),action('删除','mdi-delete',()=>{if(confirm('删除「'+row.name+'」？'))run(who=>{save(who,row.id,()=>null);message('已删除');});},'ae-btn--danger'));
          card.append(top);
          if(!row.empty){
            const gear=native('div',undefined,'preset-equip-row');
            for(const [key,label] of Object.entries(SAVED_GEAR)){
              const item=row.equipment[key],cell=native('div',undefined,'preset-equip-cell');
              cell.title=label+' · '+(item?.name||'空');cell.append(itemArt(item,key));gear.append(cell);
            }
            const skills=native('div',undefined,'preset-skills-row'),prism=native('div',undefined,'preset-prism-row');
            for(const skill of Object.values(row.skills))if(skill){const chip=native('span',undefined,'preset-skill-chip');paintSkill(chip,skill);skills.append(chip);}
            for(const key of Object.keys(SAVED_PRISMS))for(const item of row.spectra[key])prism.append(native('span',item.name,'preset-prism-chip preset-prism-chip--'+key));
            details.append(element('summary','查看配装'));
            for(const [key,label] of Object.entries(SAVED_GEAR))details.append(element('p',label+' · '+(row.equipment[key]?.name||'空')));
            for(const [key,label] of Object.entries(SAVED_SKILLS))details.append(element('p',label+' · '+(row.skills[key]?.name||'空')));
            for(const [key,label] of Object.entries(SAVED_PRISMS))details.append(element('p',label+'光谱 · '+(row.spectra[key].map(item=>item.name).join(' → ')||'空')));
            card.append(gear);if(skills.childElementCount)card.append(skills);if(prism.childElementCount){prism.prepend(native('span','棱镜','preset-prism-label'));card.append(prism);}card.append(details);
          }
          card.append(actions);list.append(card);
        }
        const add=button('',()=>run(who=>{
          const names=new Set(load(who).map(row=>row.name));let index=1;while(names.has('自定义预设 '+index))index++;
          save(who,null,()=>({id:crypto.randomUUID(),name:'自定义预设 '+index,empty:true,updatedAt:Date.now()}));scrollToNew=true;message('已建立空预设，点击「保存」记录当前配装');
        }));
        add.className='preset-card aosp-loadout-add';scoped(add);const plus=element('strong','+');plus.setAttribute('aria-hidden','true');add.append(plus,element('span','添加自定义预设'));list.append(add);
        if(scrollToNew){scrollToNew=false;add.previousElementSibling?.scrollIntoView({block:'nearest'});}
        restoreMetadata(rows);
      }
      async function run(task){
        if(busy||!character||role()!==character)return;
        busy=true;message('正在处理…');section.querySelectorAll('button,input').forEach(node=>node.disabled=true);
        try{await lock(character,()=>task(character));}catch(error){message(error.message||'操作失败',true);}
        finally{busy=false;section.querySelectorAll('button,input').forEach(node=>node.disabled=false);draw();}
      }
      async function capture(who,id,name){
        message('正在读取 '+who+' 的配装…');const {build}=await read(who);
        save(who,id,previous=>({id:previous?.id||crypto.randomUUID(),name,updatedAt:Date.now(),...build}));message('已保存「'+name+'」');
      }
      form.addEventListener('submit',event=>{event.preventDefault();const name=input.value.trim(),draft=editor;if(!name||!draft)return;
        run(who=>{save(who,draft.id,row=>({...row,name,updatedAt:Date.now()}));message('已改名');editor=null;form.hidden=true;});
      });
      draw();
      return {section,refresh(force=false){const active=role();if(busy)return;if(character!==active){character=active;editor=null;metadataChecked=metadataPending=catalogChecked=false;icons=new Map();skillsByName=new Map();skillsByCode=new Map();form.hidden=true;message('');draw();}else if(force&&!editor)draw();else if(paintOfficial().some(skill=>!skillElement(skill))&&!editor)restoreMetadata([]);}};
    }
    const dialogs=new Map();let queued=false;
    function update(){queued=false;for(const [dialog,view]of dialogs)if(!dialog.isConnected||!view.section.isConnected)dialogs.delete(dialog);
      for(const dialog of document.querySelectorAll('.ae-dialog')){
        if(dialog.querySelector('.ae-dialog__title-text h2')?.textContent.trim()!=='装备预设')continue;
        const body=dialog.querySelector('.ae-dialog__body');if(!body)continue;
        if(dialogs.has(dialog))dialogs.get(dialog).refresh();else dialogs.set(dialog,mount(dialog,body));
      }
    }
    new MutationObserver(records=>{if(!queued&&records.some(record=>!record.target.closest?.('.aosp-loadouts'))){queued=true;requestAnimationFrame(update);}}).observe(document.body,{childList:true,subtree:true});
    window.addEventListener('storage',event=>{if(event.key===CLOUD_LOADOUTS+role())for(const view of dialogs.values())view.refresh(true);});update();
  }
  function initPluginSettings(){
    if(window[Symbol.for('aether.plugin.settings')])return;window[Symbol.for('aether.plugin.settings')]=true;
    const KEY='aetheros-preferences-v1',PAGE='aetheros',MARK=Symbol.for('aether.native.settings'),states=new Set(),ICON='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsPSJNdWdlbiI+CiAgPGRlZnM+CiAgICA8Y2xpcFBhdGggaWQ9ImlubmVyLXNoYXBlIj4KICAgICAgPHJlY3QgeD0iMTAiIHk9IjEwIiB3aWR0aD0iNDQiIGhlaWdodD0iNDQiIHJ4PSIxMSIgLz4KICAgIDwvY2xpcFBhdGg+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImZyYW1lIiB4MT0iOCIgeTE9IjUiIHgyPSI1NCIgeTI9IjU5IiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CiAgICAgIDxzdG9wIHN0b3AtY29sb3I9IiNmN2Y5ZmMiIC8+CiAgICAgIDxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI2RiZTNlZCIgLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9Indhcm0iIHgxPSIxMCIgeTE9IjgiIHgyPSI0MiIgeTI9IjQ5IiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CiAgICAgIDxzdG9wIHN0b3AtY29sb3I9IiNlNDlhNGQiIC8+CiAgICAgIDxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI2M5NzkzNSIgLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImNvb2wiIHgxPSIyMiIgeTE9IjEyIiB4Mj0iNTYiIHkyPSI1NiIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgogICAgICA8c3RvcCBzdG9wLWNvbG9yPSIjODQ5YmI3IiAvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiM2MTdhOWEiIC8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogIDwvZGVmcz4KICA8cmVjdCB4PSIzIiB5PSIzIiB3aWR0aD0iNTgiIGhlaWdodD0iNTgiIHJ4PSIxNyIgZmlsbD0idXJsKCNmcmFtZSkiIC8+CiAgPGcgY2xpcC1wYXRoPSJ1cmwoI2lubmVyLXNoYXBlKSI+CiAgICA8cmVjdCB4PSIxMCIgeT0iMTAiIHdpZHRoPSI0NCIgaGVpZ2h0PSI0NCIgZmlsbD0idXJsKCNjb29sKSIgLz4KICAgIDxwYXRoIGQ9Ik0xMCAxMGg0NEwxMCA1NFoiIGZpbGw9InVybCgjd2FybSkiIC8+CiAgICA8cGF0aCBkPSJNMTAgMTBoNDQiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLW9wYWNpdHk9Ii4yMiIgc3Ryb2tlLXdpZHRoPSIyIiAvPgogIDwvZz4KICA8cmVjdCB4PSIxMCIgeT0iMTAiIHdpZHRoPSI0NCIgaGVpZ2h0PSI0NCIgcng9IjExIiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmYiIHN0cm9rZS1vcGFjaXR5PSIuNDIiIC8+CiAgPHJlY3QgeD0iMy41IiB5PSIzLjUiIHdpZHRoPSI1NyIgaGVpZ2h0PSI1NyIgcng9IjE2LjUiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzcxODM5YiIgc3Ryb2tlLW9wYWNpdHk9Ii4xOCIgLz4KPC9zdmc+Cg==';let preferences=read(),scheduled=false;
    function read(){try{const value=JSON.parse(localStorage.getItem(KEY)||'{}');return {hideIdleCanvas:typeof value?.hideIdleCanvas==='boolean'?value.hideIdleCanvas:true};}catch{return {hideIdleCanvas:true};}}
    function apply(){document.documentElement.classList.toggle('amv-hide-idle',preferences.hideIdleCanvas);for(const state of states)if(!state.instance.isUnmounted)state.instance.proxy?.$forceUpdate();}
    function dispatch(name){try{const detail=['aether-pins-settings','aether-inventory-search'].includes(name)?{character:sessionStorage.getItem(ACTIVE)||''}:null;window.top.dispatchEvent(new window.top.CustomEvent(name,{detail}));}catch{window.dispatchEvent(new Event(name));}}
    const style=element('style');style.id='aether-multiview-official-layout';style.textContent=`
      html.amv-hide-idle .aether-console .console-layout:has(>.canvas-panel:not(.story-active)){grid-template-columns:minmax(0,1fr)!important}html.amv-hide-idle .aether-console .console-layout>.canvas-panel:not(.story-active){display:none!important}.settings-card .amv-settings-logo{display:block;width:16px;height:16px;flex-shrink:0;object-fit:contain;margin-right:4px}.amv-settings-page{padding:18px 22px;box-sizing:border-box;color:var(--text-primary,#dce5f4);font:inherit}.amv-settings-page h3{margin:18px 0 7px;color:var(--text-muted,#9bacc4);font-size:11px;font-weight:500;letter-spacing:.08em}.amv-settings-page h3:first-child{margin-top:0}.amv-settings-row,.amv-settings-page .amv-settings-action{display:flex;align-items:center;width:100%;box-sizing:border-box;gap:12px;padding:13px 0;border:0;border-bottom:1px solid #91a5c71c;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}.amv-settings-row>.mdi,.amv-settings-action>.mdi{width:22px;flex:none;font-size:20px;color:#8ed3ca;text-align:center}.amv-settings-copy{display:flex;flex:1;min-width:0;flex-direction:column;gap:5px}.amv-settings-copy strong{font-size:13px;font-weight:550}.amv-settings-page small{color:var(--text-muted,#9bacc4);font-size:11px;line-height:1.65}.amv-settings-page .amv-settings-action:hover{color:var(--accent,#61f4de)}.amv-settings-chevron{flex:none;color:var(--text-muted,#9bacc4);font-size:22px;font-weight:300}.amv-settings-switch{appearance:none;position:relative;flex:0 0 36px;width:36px;height:20px;margin:0;border:1px solid #ffffff28;border-radius:20px;background:#ffffff15;cursor:pointer}.amv-settings-switch:after{content:'';position:absolute;top:3px;left:3px;width:12px;height:12px;border-radius:50%;background:#a7b4c8;transition:transform .15s}.amv-settings-switch:checked{background:color-mix(in srgb,var(--accent,#61f4de) 25%,transparent);border-color:var(--accent,#61f4de)}.amv-settings-switch:checked:after{background:var(--accent,#61f4de);transform:translateX(16px)}.amv-settings-page [role=status]{margin:12px 0 0;font-size:11px;line-height:1.6;color:var(--text-muted,#9bacc4)}.amv-settings-page [role=status]:empty{display:none}.amv-settings-switch:focus-visible,.amv-settings-action:focus-visible{outline:2px solid var(--accent,#61f4de);outline-offset:3px}@media(max-width:480px){.amv-settings-page{padding:16px 18px}}

    `;document.head.append(style);apply();
    function attach(instance){
      if(instance[MARK]){states.add(instance[MARK]);return;}if(typeof instance.render!=='function')return;
      const original=instance.render,state={instance,message:''};instance[MARK]=state;states.add(state);
      // 沿用官网的页签与页面组件，字体、选中条、键盘操作及切换动画均交给官网。
      function vnode(type,props,children){return {__v_isVNode:true,__v_skip:true,type,props,key:props?.key??null,ref:null,scopeId:instance.type.__scopeId||null,slotScopeIds:null,children,component:null,suspense:null,ssContent:null,ssFallback:null,dirs:null,transition:null,el:null,anchor:null,target:null,targetStart:null,targetAnchor:null,staticCount:0,shapeFlag:1|(Array.isArray(children)?16:typeof children==='string'?8:0),patchFlag:0,dynamicProps:null,dynamicChildren:null,appContext:null,ctx:instance};}
      const text=(type,value,props={})=>vnode(type,props,value);
      function page(){
        const icon=name=>vnode('i',{class:'mdi '+name,'aria-hidden':'true'},null),copy=(title,description)=>vnode('span',{class:'amv-settings-copy'},[text('strong',title),text('small',description)]);
        const action=(title,description,glyph,props)=>vnode('button',{type:'button',class:'amv-settings-action',...props},[icon(glyph),copy(title,description),text('span','›',{class:'amv-settings-chevron','aria-hidden':'true'})]);
        return vnode('div',{class:'settings-body amv-settings-page','data-amv-settings-page':''},[
          text('h3','界面'),vnode('label',{class:'amv-settings-row'},[icon('mdi-monitor'),copy('隐藏左侧空闲黑屏','多角色窗口共用，剧情与战斗播放仍保留。'),vnode('input',{type:'checkbox',role:'switch',class:'amv-settings-switch','aria-label':'隐藏左侧空闲黑屏','data-amv-hide-idle':'',checked:preferences.hideIdleCanvas,onChange:event=>{preferences={hideIdleCanvas:event.target.checked};try{localStorage.setItem(KEY,JSON.stringify(preferences));state.message='已保存，所有游戏窗口立即生效。';}catch{state.message='当前浏览器不允许保存，仅本页生效。';}apply();}},null)]),
          text('h3','同步'),action('数据同步','同步状态、强化读取与设备连接。','mdi-cloud-sync-outline',{'data-amv-pin-open':'','aria-label':'数据同步',onClick:()=>dispatch('aether-pins-settings')}),
          text('h3','版本'),action('检查更新','AetherOS v'+SCRIPT_VERSION,'mdi-update',{'data-amv-check-update':'',id:'aether-nav-update','aria-label':'检查更新',onClick:()=>dispatch('aether-userscript-check-updates')}),
          text('p',state.message,{role:'status'})]);
      }
      function native(template,props,children){return {...template,props:{...template.props,...props,key:PAGE},key:PAGE,ref:null,children:{default:children,_ctx:instance,_:2},component:null,el:null,anchor:null,patchFlag:1040,dynamicProps:null,dynamicChildren:null};}
      function enhance(node){
        if(Array.isArray(node))return node.map(enhance);if(!node?.__v_isVNode)return node;
        const children=node.children,name=node.type?.name||node.type?.__name;
        if(children&&typeof children.default==='function'){
          const slot=children.default,wrapped=(...args)=>{const result=slot(...args),rows=Array.isArray(result)?result:[result];
            if(name==='VTabs'){const tab=rows.find(value=>(value?.type?.name||value?.type?.__name)==='VTab');return tab?[...rows,native(tab,{value:PAGE,class:[tab.props?.class,'amv-settings-tab'],onClick:undefined},()=>[vnode('img',{src:ICON,alt:'','aria-hidden':'true',width:16,height:16,class:'amv-settings-logo'},null),'AetherOS'])]:result;}
            if(name==='VWindow'){const item=rows.find(value=>(value?.type?.name||value?.type?.__name)==='VWindowItem');return item?[...rows,native(item,{value:PAGE},()=>[page()])]:result;}
            return enhance(result);
          };Object.assign(wrapped,slot);return {...node,children:{...children,default:wrapped,_:2},patchFlag:1040,dynamicChildren:null};
        }
        if(Array.isArray(children))return {...node,children:children.map(enhance),dynamicChildren:null};return node;
      }
      instance.render=function(...args){const value=original.apply(this,args);try{return enhance(value);}catch{return value;}};instance.proxy?.$forceUpdate();
    }
    function walk(node,seen=new Set()){if(!node||typeof node!=='object'||seen.has(node))return;seen.add(node);if((node.component?.type?.name||node.component?.type?.__name)==='SettingsDialog'){attach(node.component);return;}if(node.component)walk(node.component.subTree,seen);if(Array.isArray(node.children))node.children.forEach(value=>walk(value,seen));if(node.suspense)walk(node.suspense.activeBranch,seen);}
    function mount(){scheduled=false;for(const state of states)if(state.instance.isUnmounted)states.delete(state);const cards=[...document.querySelectorAll('.settings-card')];if(cards.every(card=>card.dataset.amvNativeSettings==='true'))return;walk(document.getElementById('app')?.__vue_app__?._container?._vnode);if(states.size)cards.forEach(card=>card.dataset.amvNativeSettings='true');}
    // 只在设置弹层挂载时寻找组件，不观察背包筛选或战斗数据的日常更新。
    new MutationObserver(records=>{if(records.some(record=>record.target.nodeType===1&&(record.target.closest('.settings-card')||record.target.matches('body,.v-overlay-container,.v-overlay,.v-overlay__content')))&&!scheduled){scheduled=true;requestAnimationFrame(mount);}}).observe(document.body,{childList:true,subtree:true});
    window.addEventListener('storage',event=>{if(event.key===KEY||event.key===null){preferences=read();apply();}});mount();
  }
  function initScriptNavigation(){
    if(window.top!==window)return;
    const tools=element('div');tools.id='aether-nav-tools';
    function decorate(node,label,kind){if(node.querySelector('.amv-nav-icon'))return;const icon=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS(icon.namespaceURI,'path');icon.classList.add('amv-nav-icon');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');path.setAttribute('d',kind==='update'?'M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.8-1L20 9M4 15l2.1 3A7 7 0 0 0 17.9 17':kind==='sync'?'M6 17a4 4 0 0 1-1-7.9A7 7 0 0 1 18 7a5 5 0 0 1 0 10M9 14l3-3 3 3M12 11v10':'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z');icon.append(path);node.replaceChildren(icon,element('span',label,'amv-nav-label'));node.setAttribute('aria-label',label);node.title=label;}
    const style=element('style');style.textContent=`
      #aether-nav-tools{display:flex;align-items:center;gap:.5rem;flex-shrink:0}#aether-nav-tools>button,#aether-nav-tools>#aether-multiview-launch{position:static;display:inline-flex;align-items:center;justify-content:center;gap:.35rem;width:auto;height:1.85rem;margin:0;padding:0 .65rem;border:1px solid #ffffff17;border-radius:999px;background:#ffffff08;box-shadow:none;color:var(--text-muted,#9bacc4);font:inherit;font-size:.78rem;letter-spacing:.04em;line-height:1;white-space:nowrap;cursor:pointer}#aether-nav-tools>button:hover,#aether-nav-tools>#aether-multiview-launch:hover{color:var(--accent,#61f4de);border-color:#61f4de73;background:#61f4de14}#aether-nav-tools>button:focus-visible{outline:2px solid #92d8c6;outline-offset:2px}#aether-nav-tools .amv-nav-icon{display:block;width:16px;height:16px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}@media(max-width:680px){#aether-nav-tools{gap:.35rem}#aether-nav-tools>button,#aether-nav-tools>#aether-multiview-launch{width:1.85rem;padding:0}#aether-nav-tools .amv-nav-label{display:none}}
    `;document.head.append(style);
    let launch=null;function mount(){const header=document.querySelector('.aether-console .console-header');launch=launch||document.getElementById('aether-multiview-launch');if(!header||!launch)return;const host=header.querySelector(':scope>.header-actions')||header;decorate(launch,'多角色同屏','desktop');if(launch.parentElement!==tools)tools.prepend(launch);if(tools.parentElement!==host||host.firstChild!==tools)host.prepend(tools);}
    // 官网导航异步出现或重新挂载时恢复入口，不观察背包和战斗的普通内容更新。
    const selector='.aether-console,.console-header,.header-actions',root=document.getElementById('app')||document.body;
    new MutationObserver(records=>{if(records.some(record=>record.target.matches?.('.console-header,.console-header>.header-actions')||[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1&&(node.matches(selector)||node.querySelector(selector)||node===tools))))mount();}).observe(root,{childList:true,subtree:true});setTimeout(mount,0);
  }
  function reinforceForecast(info){
    const next=info?.next;if(!next||info.maxed)return null;const p=next.success_rate,pity=next.pity??0,fails=next.fails??0;if(!Number.isFinite(p)||p<0||p>1||!Number.isInteger(pity)||pity<0||!Number.isInteger(fails)||fails<0)return null;
    const maximum=next.guaranteed===true||p===1?1:pity>0?Math.max(1,pity-fails+1):null,expected=maximum===1?1:p===0?maximum:maximum===null?1/p:-Math.expm1(maximum*Math.log1p(-p))/p;if(!Number.isFinite(expected))return null;return {expected,maximum};
  }
  const historyRandom=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),value=>value.toString(16).padStart(2,'0')).join('');
  function normalizeReinforceRecord(value,migrate=false){
    const count=n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000,stamp=n=>n===null||n===undefined||Number.isSafeInteger(n)&&n>=0;
    if(value?.version!==1||typeof value.character!=='string'||!value.character.trim()||value.character.length>100||typeof value.uuid!=='string'||!value.uuid.trim()||value.uuid.length>128||!value.levels||typeof value.levels!=='object'||Array.isArray(value.levels)||Object.keys(value.levels).length>100)return null;
    const row={version:1,character:value.character,uuid:value.uuid,name:typeof value.name==='string'?value.name.slice(0,200):'',item_id:typeof value.item_id==='string'?value.item_id.slice(0,128):'',slot:typeof value.slot==='string'?value.slot.slice(0,30):'',rarity:Number.isInteger(value.rarity)&&value.rarity>=0&&value.rarity<=10?value.rarity:0,level:Number.isInteger(value.level)&&value.level>=0&&value.level<=100?value.level:0,levels:{}};
    for(const [level,item]of Object.entries(value.levels)){
      if(!/^[1-9]\d?$|^100$/.test(level)||!item||!count(item.fails)||!count(item.material)||!count(item.voucher)||typeof item.complete!=='boolean'||item.attempts!==null&&item.attempts!==undefined&&(!count(item.attempts)||item.attempts<1)||!stamp(item.success_at)||!stamp(item.confirmed_at)||!stamp(item.observed_at))return null;
      let samples=item.samples;if(samples===undefined&&migrate)samples=item.material||item.voucher?{[historyRandom()]:{material:item.material,voucher:item.voucher}}:{};
      if(!samples||typeof samples!=='object'||Array.isArray(samples)||Object.keys(samples).length>2000)return null;
      const normalized={};for(const [id,part]of Object.entries(samples)){if(!/^[a-f0-9]{32}$/.test(id)||!part||!count(part.material)||!count(part.voucher))return null;normalized[id]={material:part.material,voucher:part.voucher};}
      const material=Object.values(normalized).reduce((n,x)=>n+x.material,0),voucher=Object.values(normalized).reduce((n,x)=>n+x.voucher,0);if(!count(material)||!count(voucher)||material!==item.material||voucher!==item.voucher)return null;
      row.levels[level]={fails:item.fails,material,voucher,complete:item.complete,attempts:item.complete?item.attempts??null:null,pending:!item.complete&&item.pending===true,success_at:item.complete?item.success_at??null:null,confirmed_at:item.confirmed_at??null,observed_at:item.observed_at??0,conflict:item.conflict===true,samples:normalized};row.level=Math.max(row.level,Number(level)-(item.complete?0:1));
    }
    const events=value.events??{};if(!events||typeof events!=='object'||Array.isArray(events)||Object.keys(events).length>5000)return null;row.events={};
    for(const [id,event]of Object.entries(events)){
      if(!/^[a-f0-9]{32}$/.test(id)||!event||!Number.isInteger(event.target)||event.target<1||event.target>100||!Number.isSafeInteger(event.started_at)||event.started_at<0||!stamp(event.finished_at)||event.finished_at!=null&&event.finished_at<event.started_at||!['pending','unknown','rejected','success','failure'].includes(event.status)||!['manual','daily'].includes(event.source)||!['material','voucher'].includes(event.method)||event.fails_before!=null&&!count(event.fails_before)||!count(event.count)||event.count<1)return null;
      row.events[id]={target:event.target,started_at:event.started_at,finished_at:event.finished_at??null,status:event.status,source:event.source,method:event.method,fails_before:event.fails_before??null,count:event.count,conflict:event.conflict===true};
    }
    return row;
  }
  function mergeReinforceRecord(left,right){
    left=normalizeReinforceRecord(left,true);right=normalizeReinforceRecord(right);if(!right)return null;if(!left)return right;if(left.character!==right.character||left.uuid!==right.uuid)return null;
    const row={...right,level:Math.max(left.level,right.level),levels:{}};for(const key of ['name','item_id','slot','rarity'])row[key]=right[key]||left[key];
    for(const level of [...new Set([...Object.keys(left.levels),...Object.keys(right.levels)])].sort((a,b)=>a-b)){
      const a=left.levels[level]||{},b=right.levels[level]||{},samples={};for(const id of new Set([...Object.keys(a.samples||{}),...Object.keys(b.samples||{})]))samples[id]={material:Math.max(a.samples?.[id]?.material||0,b.samples?.[id]?.material||0),voucher:Math.max(a.samples?.[id]?.voucher||0,b.samples?.[id]?.voucher||0)};
      const known=new Set([a,b].filter(x=>x.complete&&x.attempts!=null).map(x=>x.attempts)),complete=!!(a.complete||b.complete),conflict=!!(a.conflict||b.conflict||known.size>1),latest=(a.observed_at||0)>(b.observed_at||0)?a:b;
      const value={fails:Math.max(a.fails||0,b.fails||0),material:Object.values(samples).reduce((n,x)=>n+x.material,0),voucher:Object.values(samples).reduce((n,x)=>n+x.voucher,0),complete,attempts:known.size&&!conflict?[...known][0]:null,pending:!complete&&((a.observed_at||0)===(b.observed_at||0)?!!(a.pending||b.pending):!!latest.pending),success_at:null,confirmed_at:null,observed_at:Math.max(a.observed_at||0,b.observed_at||0),conflict,samples};for(const key of ['success_at','confirmed_at']){const values=[a[key],b[key]].filter(x=>x!=null);if(values.length)value[key]=Math.min(...values);}row.levels[level]=value;
    }
    row.events={...left.events};const rank={pending:0,unknown:1,rejected:2,failure:3,success:3};
    for(const [id,event]of Object.entries(right.events)){
      const previous=row.events[id];if(!previous){row.events[id]=event;continue;}
      const chosen=rank[previous.status]>rank[event.status]?previous:event,finished=[previous.finished_at,event.finished_at].filter(value=>value!=null),conflict=previous.conflict||event.conflict||previous.target!==event.target||previous.source!==event.source||previous.method!==event.method||new Set([previous.status,event.status]).size===2&&[previous.status,event.status].every(value=>['success','failure'].includes(value));
      row.events[id]={...chosen,started_at:Math.min(previous.started_at,event.started_at),finished_at:finished.length?Math.max(...finished):null,conflict};
    }
    return normalizeReinforceRecord(row);
  }
  function createReinforceHistory(storage=localStorage,now=()=>Date.now(),changed=()=>{}){
    const prefix='aether-reinforce-history-v1:',observation=historyRandom();let warning='';
    const valid=value=>Number.isSafeInteger(value)&&value>=0;
    const key=(character,uuid)=>prefix+JSON.stringify([character,uuid]);
    function read(character,uuid){try{const row=JSON.parse(storage.getItem(key(character,uuid))||'null');if(row?.version===1&&row.character===character&&row.uuid===uuid&&row.levels&&typeof row.levels==='object'&&!Array.isArray(row.levels)&&Object.entries(row.levels).every(([level,value])=>/^[1-9]\d*$/.test(level)&&value&&valid(value.fails)&&valid(value.material)&&valid(value.voucher)&&typeof value.complete==='boolean'&&(value.attempts===undefined||value.attempts===null||valid(value.attempts))))return row;}catch{}return {version:1,character,uuid,name:'',levels:{}};}
    function write(row,before){const normalized=normalizeReinforceRecord(row,true);if(!normalized||JSON.stringify(normalized)===before)return;try{storage.setItem(key(row.character,row.uuid),JSON.stringify(normalized));warning='';try{changed(normalized);}catch{}}catch{warning='无法保存强化记录，请检查浏览器存储空间';}}
    function observe(character,uuid,info){if(!character||!uuid||!valid(info?.equipment?.reinforce_level))return null;const row=read(character,uuid),before=JSON.stringify(row),level=info.equipment.reinforce_level;row.name=info.equipment.name||row.name;row.level=level;for(const field of ['item_id','slot','rarity'])row[field]=info.equipment[field]??row[field];
      for(const [target,value]of Object.entries(row.levels))if(Number(target)<=level&&!value.complete){value.complete=true;value.attempts=null;value.pending=false;value.confirmed_at=now();value.observed_at=now();}
      if(!info.maxed&&valid(info.next?.fails)){const target=level+1,previous=row.levels[target];if(!previous||previous.complete||info.next.fails<previous.fails)row.levels[target]={fails:info.next.fails,material:0,voucher:0,complete:false,observed_at:now(),samples:{}};else if(previous.fails!==info.next.fails||previous.pending){previous.fails=info.next.fails;previous.pending=false;previous.observed_at=now();}}
      write(row,before);return row;
    }
    function begin(character,uuid,info,kind,useVoucher){if(!observe(character,uuid,info)||!valid(info?.next?.fails)||info.maxed)return null;const row=read(character,uuid),before=JSON.stringify(row),target=info.equipment.reinforce_level+1,value=row.levels[target],id=historyRandom(),started=now();value.pending=true;value.observed_at=started;row.events??={};row.events[id]={target,started_at:started,finished_at:null,status:'pending',source:'manual',method:useVoucher?'voucher':'material',fails_before:info.next.fails,count:1,conflict:false};write(row,before);return {character,uuid,target,fails:info.next.fails,kind,useVoucher,id,closed:false};}
    function finish(context,data,error=false){if(!context||context.closed)return;context.closed=true;const row=read(context.character,context.uuid),before=JSON.stringify(row),value=row.levels[context.target],event=row.events?.[context.id],reply=data?.data;
      if(event){event.finished_at=Math.max(event.started_at,now());event.status=!error&&data?.code===0&&typeof reply?.success==='boolean'&&reply.new_level===context.target-(reply.success?0:1)?reply.success?'success':'failure':typeof data?.code==='number'&&data.code!==0?'rejected':'unknown';event.count=context.kind==='attempt'?1:valid(reply?.attempts)&&reply.attempts>0?reply.attempts:1;}
      if(!value){write(row,before);return;}
      value.observed_at=now();const result=data?.data;if(error||data?.code!==0||typeof result?.success!=='boolean'||result.new_level!==context.target-(result.success?0:1)){value.pending=true;write(row,before);return;}
      const count=context.kind==='attempt'?1:valid(result.attempts)&&result.attempts>0?result.attempts:null;value.pending=false;if(count!==null){value.samples??={};value.samples[observation]??={material:0,voucher:0};value.samples[observation][context.useVoucher?'voucher':'material']+=count;for(const field of ['material','voucher'])value[field]=Object.values(value.samples).reduce((n,x)=>n+x[field],0);}
      if(result.success){const attempts=count===null?null:context.fails+count;if(value.complete&&value.attempts!=null&&attempts!=null&&value.attempts!==attempts){value.conflict=true;value.attempts=null;}else if(!value.conflict)value.attempts=attempts??value.attempts??null;value.complete=true;value.success_at=Math.min(value.success_at??now(),now());}else if(valid(result.fails))value.fails=Math.max(value.fails,result.fails);else if(count!==null)value.fails=Math.max(value.fails,context.fails+count);else value.pending=true;
      write(row,before);
    }
    return {read,observe,begin,finish,get warning(){return warning;}};
  }
  function createReinforceBridge(){
    const cache=new Map(),latestInfo=new Map(),listeners=new Set(),requests=new WeakMap(),locks=new Set(),bindings=new Map(),history=createReinforceHistory(localStorage,()=>Date.now(),()=>{try{window.top.dispatchEvent(new window.top.Event('aether-history-change'));}catch{}});let sequence=0;
    const role=()=>{try{return sessionStorage.getItem(ACTIVE)||'';}catch{return '';}};
    function identity(body,character=role()){if(!body||!['backpack','equipped'].includes(body.source))return null;const id=body.source==='backpack'?body.uuid:body.slot;return typeof id==='string'&&id?JSON.stringify([character,body.source,id]):null;}
    function parse(value){try{return typeof value==='string'?JSON.parse(value):value&&typeof value==='object'?value:null;}catch{return null;}}
    function describe(url,method,body){try{const target=new URL(url,ORIGIN);if(target.origin!==ORIGIN||String(method).toUpperCase()!=='POST'||!/^\/api\/aether\/reinforce\/(info|attempt|attempt_continuous)$/.test(target.pathname))return null;const data=parse(body),key=identity(data,target.searchParams.get('_aether_character')||role());return key?{id:++sequence,key,body:data,kind:target.pathname.split('/').at(-1),baseline:cache.get(key)}:null;}catch{return null;}}
    function remember(key,item){const record=cache.get(key);if(!record||typeof item?.uuid!=='string'||!item.uuid)return null;const character=JSON.parse(key)[0];if(record.uuid!==item.uuid){record.uuid=item.uuid;history.observe(character,item.uuid,{...record.info,equipment:{...record.info.equipment,name:record.info.equipment?.name||item.name}});}return history.read(character,item.uuid);}
    function bind(key,item){if(key&&typeof item?.uuid==='string'&&item.uuid){bindings.set(key,item.uuid);if(bindings.size>64)bindings.delete(bindings.keys().next().value);}}
    function begin(request){const record=request?.baseline,uuid=request.body.source==='backpack'?request.body.uuid:bindings.get(request.key);if(record&&uuid&&request.kind!=='info')request.history=history.begin(JSON.parse(request.key)[0],uuid,record.info,request.kind,request.body.use_voucher===true);}
    function emit(event){if(event.phase==='start'&&event.kind==='info'){latestInfo.set(event.key,event.id);cache.delete(event.key);}for(const listener of listeners)try{listener(event);}catch{}}
    function finish(request,data,error=false){const event={...request,phase:'done',data:parse(data),error};history.finish(request.history,event.data,error);if(request.kind==='info'&&latestInfo.get(request.key)===request.id&&!error&&event.data?.code===0&&event.data.data&&typeof event.data.data==='object'){cache.set(request.key,{id:request.id,info:event.data.data});if(cache.size>64)cache.delete(cache.keys().next().value);}emit(event);}
    // 观察强化响应；连续用券期间阻止当前装备改用材料，其他请求保持原样。
    const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open=function(method,url,...args){requests.set(this,{method,url});return Reflect.apply(open,this,[method,url,...args]);};
    XMLHttpRequest.prototype.send=function(body){const previous=requests.get(this),request=previous&&describe(previous.url,previous.method,body);if(request){emit({...request,phase:'start'});if(locks.has(request.key)&&request.kind!=='info'&&(request.kind!=='attempt'||request.body.use_voucher!==true)){finish(request,null,true);throw new Error('连续用券期间禁止材料强化');}begin(request);let ended=false;const done=error=>{if(ended)return;ended=true;let value;try{value=this.response;}catch{}finish(request,value,error||this.status<200||this.status>=300);};this.addEventListener('load',()=>done(false),{once:true});this.addEventListener('error',()=>done(true),{once:true});this.addEventListener('timeout',()=>done(true),{once:true});this.addEventListener('abort',()=>done(true),{once:true});}return Reflect.apply(send,this,[body]);};
    const fetch=window.fetch;window.fetch=function(input,options){const request=typeof input==='string'||input instanceof URL?describe(String(input),options?.method||'GET',options?.body):null;if(request){emit({...request,phase:'start'});if(locks.has(request.key)&&request.kind!=='info'&&(request.kind!=='attempt'||request.body.use_voucher!==true)){finish(request,null,true);throw new Error('连续用券期间禁止材料强化');}begin(request);}let promise;try{promise=Reflect.apply(fetch,this,arguments);}catch(error){if(request)finish(request,null,true);throw error;}if(request)promise.then(response=>response.clone().text().then(value=>finish(request,value,!response.ok),()=>finish(request,null,true)),()=>finish(request,null,true));return promise;};
    function wait(test,timeout=20000){let timer,listener;const promise=new Promise((resolve,reject)=>{listener=event=>{if(test(event)){clearTimeout(timer);listeners.delete(listener);resolve(event);}};listeners.add(listener);timer=setTimeout(()=>{listeners.delete(listener);reject(new Error('等待官网响应超时，已停止；请检查本次结果'));},timeout);});return {promise,cancel(){clearTimeout(timer);listeners.delete(listener);}};}
    window.addEventListener('storage',event=>{if(event.key===null||event.key?.startsWith('aether-reinforce-history-v1:'))emit({kind:'history',phase:'changed'});});try{window.top.addEventListener('aether-history-sync-status',()=>emit({kind:'history',phase:'changed'}));}catch{}
    return {identity,role,cache,history,remember,bind,lock(key){if(locks.has(key))return false;locks.add(key);return true;},release(key){locks.delete(key);},get sequence(){return sequence;},subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},wait};
  }
  function createReinforceAssistant(instance,panel,bridge,queueSync){
    panel.classList.add('amv-reinforce-assistant');let validation='',disposed=false,state={key:null,native:null,busy:true},run=null;const notes=new Set(),box=element('div',undefined,'amv-voucher-tools'),limit=element('input'),start=button('连续用券',begin),hint=element('small'),progress=element('section',undefined,'amv-voucher-progress'),status=element('span'),stop=button('停止',()=>{if(run){run.cancelled=true;status.textContent='已请求停止，当前请求完成后不再继续';stop.disabled=true;}});box.dataset.amvVoucherTools='';start.dataset.amvVoucherStart='';progress.dataset.amvVoucherProgress='';stop.dataset.amvVoucherStop='';box.hidden=true;limit.type='number';limit.min='1';limit.value='1';limit.step='1';limit.setAttribute('aria-label','最多使用强化券数量');limit.addEventListener('input',()=>{validation='';queueSync();});const label=element('label','最多使用 ');label.append(limit,element('span',' 张，成功即停'));box.append(label,start,hint);progress.hidden=true;progress.setAttribute('role','status');progress.setAttribute('aria-live','polite');progress.append(status,stop);document.body.append(progress);
    const style=element('style');style.textContent=`.amv-reinforce-history{margin-top:12px;border:1px solid #ffffff18;border-radius:7px;padding:9px 11px;color:#b8c9d5;font-size:.76rem}.amv-reinforce-history[hidden]{display:none!important}.amv-reinforce-history summary{cursor:pointer;color:#a6dacd}.amv-reinforce-history>a{display:inline-block;margin-top:8px;color:#9fd8ca;font-size:.72rem}.amv-reinforce-history>small{display:block;margin-top:8px;color:#91a3b5;font-size:.7rem}.amv-reinforce-history-row{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px 12px;padding-top:8px}.amv-reinforce-history-row>span{min-width:28px;color:#efcb7d}.amv-reinforce-history-row strong{font-weight:500;color:#badfd3}.amv-reinforce-history-row small{color:#91a3b5}.amv-reinforce-history>div>small{display:block;margin-top:8px}.amv-reinforce-assistant .cost-row:has(.amv-reinforce-estimate){display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:baseline;gap:5px 8px}.amv-reinforce-assistant .cost-row>.cost-name{grid-column:2;grid-row:1;min-width:0;white-space:normal;overflow-wrap:break-word}.amv-reinforce-assistant .cost-row>.cost-val{grid-column:3;grid-row:1;white-space:nowrap}.amv-reinforce-assistant .cost-row>.cost-owned{grid-column:4;grid-row:1;white-space:nowrap}.amv-reinforce-assistant .cost-row>.v-icon,.amv-reinforce-assistant .cost-row>i{grid-column:1;grid-row:1}.amv-reinforce-assistant .cost-row>.amv-reinforce-estimate{grid-column:1/-1;margin-left:0;display:flex;flex-wrap:wrap;gap:3px 8px;min-width:0}.amv-reinforce-assistant .amv-reinforce-projection{white-space:normal;overflow-wrap:anywhere}.amv-reinforce-projection{display:inline-block;white-space:nowrap}.amv-reinforce-remaining.is-negative{color:#ff7f88}.amv-reinforce-estimate{margin-left:7px;color:#9fc8bc;font-size:.72rem;white-space:normal}.amv-voucher-tools{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:8px;padding:8px;border:1px solid #ffffff18;border-radius:7px;color:#c6cfda;font-size:.76rem}.amv-voucher-tools[hidden],.amv-voucher-progress[hidden]{display:none!important}.amv-voucher-tools label{display:inline-flex;align-items:center;gap:5px}.amv-voucher-tools input{width:55px;padding:4px 6px;color:inherit;background:#080f1b55;border:1px solid #ffffff20;border-radius:5px;font:inherit}.amv-voucher-tools button,.amv-voucher-progress button{padding:5px 8px;border:1px solid #ffffff20;border-radius:5px;background:#ffffff0a;color:#c6dfd6;font:inherit;cursor:pointer}.amv-voucher-tools small{flex:1 1 100%;color:#9baaba}.amv-voucher-tools button:disabled{opacity:.4;cursor:default}.amv-voucher-progress{position:fixed;right:12px;bottom:64px;z-index:2147483647;max-width:calc(100vw - 24px);box-sizing:border-box;display:flex;align-items:center;gap:12px;padding:12px;border:1px solid #ffffff25;border-radius:10px;background:#242930fa;color:#e7e9ed;box-shadow:0 6px 24px #0005;font:12px/1.5 system-ui}.amv-voucher-running .reinforce-btn,.amv-voucher-running .refresh-btn,.amv-voucher-running .source-toggle,.amv-voucher-running .chip-row-wrapper,.amv-voucher-running .voucher-toggle{opacity:.6}.amv-voucher-tools input:focus-visible,.amv-voucher-tools button:focus-visible,.amv-voucher-progress button:focus-visible{outline:2px solid #87d9c3;outline-offset:2px}`;document.head.append(style);
    function walk(node,visit,seen=new Set()){if(!node||typeof node!=='object'||seen.has(node))return;seen.add(node);visit(node);if(Array.isArray(node.children))node.children.forEach(child=>walk(child,visit,seen));}
    function classes(node){const value=node?.props?.class;return typeof value==='string'?value:Array.isArray(value)?value.filter(part=>typeof part==='string').join(' '):'';}
    function capture(vnode){let mode=null,item=null,native=null;walk(vnode,node=>{const name=classes(node).split(/\s+/);if(name.includes('source-toggle'))mode=node.props?.modelValue;if(name.includes('reinforce-btn'))native=node.props;if(node.type?.__name==='ItemChip'&&node.props?.selected)item=node.props.item;});const body=mode==='backpack'?{source:mode,uuid:item?.uuid}:mode==='equipped'?{source:mode,slot:item?.slot}:null;const key=bridge.identity(body);bridge.bind(key,item);if(key!==state.key)validation='';state={key,item,native:native?.onClick,busy:!!native?.disabled||!!native?.loading};if(run&&run.key!==state.key)run.cancelled=true;}
    function block(event){if(run&&event.target.closest?.('.reinforce-btn,.refresh-btn,.source-toggle,.chip-row-wrapper,.voucher-toggle')){event.preventDefault();event.stopImmediatePropagation();}}
    panel.addEventListener('click',block,true);const unsubscribe=bridge.subscribe(()=>queueSync());
    function current(){return state.key?bridge.cache.get(state.key):null;}
    function checked(){return !!panel.querySelector('.voucher-toggle input')?.checked;}
    function number(value){return Number.isInteger(value)?value.toLocaleString('en-US'):value.toLocaleString('en-US',{maximumFractionDigits:2,minimumFractionDigits:0});}
    function sync(){if(disposed)return;for(const note of notes)if(!note.isConnected)notes.delete(note);const record=current(),info=record?.info,recorded=record&&bridge.remember(state.key,state.item),forecast=reinforceForecast(info),voucher=panel.querySelector('.voucher-toggle'),using=checked();syncHistory(recorded,info);for(const row of panel.querySelectorAll('.cost-card .cost-row')){const value=row.querySelector('.cost-val');if(!value)continue;let note=row.querySelector('.amv-reinforce-estimate');if(!forecast){note?.remove();continue;}const cost=Number(value.textContent.replaceAll(',',''));if(!Number.isFinite(cost)||cost<0)continue;if(!note){note=element('span',undefined,'amv-reinforce-estimate');row.append(note);notes.add(note);}const ownedText=row.querySelector('.cost-owned')?.textContent.trim().replaceAll(',',''),ownedMatch=ownedText?.match(/^[（(]?\s*(-?\d+(?:\.\d+)?)\s*[）)]?$/),owned=ownedMatch?Number(ownedMatch[1]):null,signature=[using,cost,forecast.expected,forecast.maximum,owned].join(':');if(note.dataset.amvEstimateSignature!==signature){note.dataset.amvEstimateSignature=signature;note.replaceChildren();const append=(label,consumption)=>{const group=element('span',undefined,'amv-reinforce-projection');group.append(document.createTextNode(label));note.append(group);const remaining=element('span',undefined,'amv-reinforce-remaining');let value=owned===null?null:owned-consumption;if(value!==null&&Math.abs(value)<1e-9)value=0;remaining.textContent='（余 '+(value===null?'—':number(value))+'）';remaining.classList.toggle('is-negative',value!==null&&value<0);group.append(remaining);};if(using)append('用券：材料 0',0);else{append('期望≈'+number(cost*forecast.expected),cost*forecast.expected);if(forecast.maximum===null)note.append(document.createTextNode('无有限保底'));else append('至多 '+number(cost*forecast.maximum),cost*forecast.maximum);}}note.title='到下一级，预计 '+number(forecast.expected)+' 次'+(forecast.maximum===null?'，没有有限次数上限':'，最多 '+forecast.maximum+' 次（已计入当前保底进度）');}
      if(voucher&&box.previousElementSibling!==voucher)voucher.after(box);const available=info?.voucher_count;box.hidden=!using||!Number.isInteger(available)||available<1||!forecast||typeof state.native!=='function';limit.max=String(available||1);limit.disabled=!!run;start.disabled=!!run||state.busy;const text=validation||(forecast?'预计≈'+number(forecast.expected)+' 张'+(forecast.maximum===null?'':'，最多 '+forecast.maximum+' 张')+'；券不足或出错会停止，不改用材料。':'');if(hint.textContent!==text)hint.textContent=text;if(run&&(state.key!==run.key||!panel.isConnected||instance.isUnmounted))run.cancelled=true;
    }
    const historyBox=element('details',undefined,'amv-reinforce-history'),historyTitle=element('summary'),historyRows=element('div'),historyNote=element('small'),historyLink=element('a','查看 Web 强化历史');historyLink.target='_blank';historyLink.rel='noopener noreferrer';historyLink.referrerPolicy='no-referrer';historyLink.hidden=true;let historySignature='';historyBox.dataset.amvReinforceHistory='';historyBox.hidden=true;historyBox.append(historyTitle,historyRows,historyNote,historyLink);
    function syncHistory(record,info){const target=panel.querySelector('.detail-panel');if(target&&!target.contains(historyBox))target.append(historyBox);historyBox.hidden=!record;if(!record)return;let cloud;try{cloud=window.top[Symbol.for('aether.history.sync.status')];}catch{}historyLink.hidden=!cloud?.server;if(cloud?.server)historyLink.href=cloud.server+'/admin/aether?character_view=history#aether-equipment';const signature=JSON.stringify([record,info?.next?.fails,bridge.history.warning,cloud]);if(signature===historySignature)return;historySignature=signature;const current=record.levels[(info?.equipment?.reinforce_level??0)+1],fails=current?.fails??info?.next?.fails;historyTitle.textContent='强化记录'+(current?.complete?' · +'+(info.equipment.reinforce_level+1)+(current.attempts===null?' 已成功，次数未记录':' 第 '+current.attempts+' 次成功'):Number.isSafeInteger(fails)?' · 已失败 '+fails+' 次，下次第 '+(fails+1)+' 次':'');historyRows.replaceChildren();const rows=Object.entries(record.levels).filter(([level,row])=>row.complete).sort((a,b)=>Number(b[0])-Number(a[0]));for(const [level,row]of rows){const line=element('div',undefined,'amv-reinforce-history-row'),label=element('span','+'+level),result=element('strong',row.conflict?'成功次数存在冲突':row.attempts===null?'成功次数未记录':'第 '+row.attempts+' 次成功'),method=element('small','已记录：材料 '+(row.material||0)+' 次 · 用券 '+(row.voucher||0)+' 次');if(row.success_at){result.title=new Date(row.success_at).toLocaleString();method.textContent+=' · '+new Date(row.success_at).toLocaleString(undefined,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}line.append(label,result,method);historyRows.append(line);}if(!rows.length)historyRows.append(element('small','暂无已记录的成功强化'));const attempts=Object.values(record.events||{}).sort((a,b)=>b.started_at-a.started_at);if(attempts.length){historyRows.append(element('small','最近逐次记录（全部见 Web）'));for(const entry of attempts.slice(0,10)){const line=element('div',undefined,'amv-reinforce-history-row'),state=entry.conflict?'结果冲突':({success:'成功',failure:'失败',unknown:'待核实',pending:'等待结果',rejected:'请求被拒绝'}[entry.status]||'待核实');line.append(element('span','+'+entry.target),element('strong',state),element('small',new Date(entry.started_at).toLocaleString(undefined,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})+' · '+(entry.source==='daily'?'每日自动':'手动')+' · '+(entry.method==='voucher'?'用券':'材料')+(entry.count>1?' ×'+entry.count:'')));historyRows.append(line);}}historyNote.textContent=bridge.history.warning||(current?.pending?'本次结果待核实，重新选择装备可读取服务器当前进度。':cloud?.message||'强化记录仅存本机，连接数据同步后自动同步');}
    function bounded(promise,ms=20000){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('等待官网刷新超时，已停止；请检查本次结果')),ms);})]).finally(()=>clearTimeout(timer));}
    async function begin(){if(run||disposed)return;const record=current(),info=record?.info,n=Number(limit.value);if(!record||!reinforceForecast(info)||!Number.isInteger(n)||n<1||n>info.voucher_count||!checked()||state.busy||typeof state.native!=='function'){validation='请输入不超过当前强化券数量的正整数';hint.textContent=validation;return;}validation='';const active={key:state.key,level:info.equipment?.reinforce_level,limit:n,used:0,cancelled:false,lastStart:0,character:bridge.role()};if(!Number.isInteger(active.level)||!bridge.lock(active.key))return;run=active;panel.classList.add('amv-voucher-running');progress.hidden=false;stop.disabled=false;stop.textContent='停止';sync();let message='';try{while(active.used<active.limit&&!active.cancelled){if(disposed||!panel.isConnected||instance.isUnmounted||bridge.role()!==active.character||state.key!==active.key||!checked()||state.busy)break;const latest=current();if(!latest||latest.info.voucher_count<1||latest.info.equipment?.reinforce_level!==active.level)break;const delay=500-(performance.now()-active.lastStart);if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));if(active.cancelled||disposed||!panel.isConnected||panel.closest('[inert]')||bridge.role()!==active.character||state.key!==active.key||!checked()||state.busy||current()?.info.voucher_count<1||current()?.info.equipment?.reinforce_level!==active.level)break;active.lastStart=performance.now();status.textContent='连续用券 '+active.used+' / '+active.limit+'，正在等待本次结果';const after=bridge.sequence,wait=bridge.wait(event=>event.phase==='done'&&['attempt','attempt_continuous'].includes(event.kind)&&event.key===active.key&&event.id>after);let response;try{const native=Promise.resolve(state.native());native.catch(()=>{});response=await wait.promise;await bounded(native);}finally{wait.cancel();}if(response.kind!=='attempt'||response.body.use_voucher!==true||response.error||response.data?.code!==0||typeof response.data.data?.success!=='boolean')throw new Error('本次强化未确认，已停止；请刷新检查，勿重复提交');active.used++;const result=response.data.data;if(result.success||result.new_level>active.level){message='强化成功，已执行 '+active.used+' 次用券强化';break;}if(result.new_level!==active.level)throw new Error('装备等级发生变化，已停止');if(reinforceForecast(latest.info)?.maximum===1)throw new Error('预期保底或必定成功却未成功，已停止，请检查结果');if(active.cancelled||active.used>=active.limit)break;const fresh=current();if(!fresh||fresh.id<=response.id){const update=bridge.wait(event=>event.phase==='done'&&event.kind==='info'&&event.key===active.key&&event.id>response.id);try{const received=await update.promise;if(received.error||received.data?.code!==0||!current()||current().id<=response.id)throw new Error('强化信息未刷新，已停止；请检查本次结果');}finally{update.cancel();}}await new Promise(resolve=>setTimeout(resolve,0));sync();}
        if(!message)message=active.cancelled?'已停止，已执行 '+active.used+' 次用券强化':'本轮结束，已执行 '+active.used+' 次用券强化';
      }catch(error){message=error.message||'连续用券已停止，请检查本次结果';}finally{bridge.release(active.key);if(run===active)run=null;panel.classList.remove('amv-voucher-running');status.textContent=message;stop.disabled=false;stop.textContent='关闭';stop.onclick=()=>{if(!run)progress.hidden=true;};sync();}}
    function dispose(){disposed=true;if(run)run.cancelled=true;unsubscribe();panel.removeEventListener('click',block,true);box.remove();historyBox.remove();progress.remove();style.remove();notes.forEach(node=>node.remove());panel.classList.remove('amv-voucher-running','amv-reinforce-assistant');}
    return {capture,sync,dispose};
  }
  function initReinforceFilters(){
    const guard=Symbol.for('aether.reinforce.filters');if(window[guard])return;window[guard]=true;
    const root=document.getElementById('app');if(!root)return;const bridge=createReinforceBridge(),controllers=new Set(),PAGE_SIZE=30,elements={fire:['火','mdi-fire','#ff7a5c'],water:['水','mdi-water','#62d1ff'],lightning:['雷','mdi-lightning-bolt','#ffd451'],earth:['地','mdi-terrain','#9bd36e'],wind:['风','mdi-weather-windy','#6eeedc'],light:['光','mdi-white-balance-sunny','#f9ffb5'],dark:['暗','mdi-moon-waning-crescent','#a98bff'],none:['未标注','mdi-circle-outline','#a3acbb']},rarities={1:'#9ea3b0',2:'#6ddc8e',3:'#5db8ff',4:'#c47aff',5:'#ffc84a',6:'#ff5b5b'};
    const style=element('style');style.textContent=`
      .amv-reinforce-tools,.amv-reinforce-pages{font:inherit;color:inherit;flex-shrink:0;min-width:0}.amv-reinforce-tools [hidden],.amv-reinforce-tools[hidden],.amv-reinforce-pages[hidden]{display:none!important}.amv-reinforce-tools{display:flex;flex-direction:column;gap:6px}.amv-reinforce-tools input{width:100%;box-sizing:border-box;margin:0;padding:6px 8px;border:1px solid #ffffff18;border-radius:6px;background:#080f1b55;color:inherit;font:inherit;font-size:.76rem}.amv-reinforce-chips{display:flex;flex-wrap:wrap;gap:4px}.amv-reinforce-tools button,.amv-reinforce-pages button{display:inline-flex;align-items:center;justify-content:center;gap:3px;margin:0;padding:3px 6px;border:1px solid #ffffff12;border-radius:5px;background:#ffffff04;color:var(--amv-chip,#aab7c7);font:inherit;font-size:.7rem;line-height:1.5;cursor:pointer}.amv-reinforce-tools button[aria-pressed=true]{border-color:var(--amv-chip,#87d9c3);background:#ffffff0d}.amv-reinforce-tools button:hover,.amv-reinforce-pages button:hover{background:#ffffff0d}.amv-reinforce-tools input:focus-visible,.amv-reinforce-tools button:focus-visible,.amv-reinforce-pages button:focus-visible{outline:2px solid #87d9c3;outline-offset:2px}.amv-reinforce-pages{display:flex;align-items:center;justify-content:space-between;gap:5px;font-size:.7rem;color:#9daec1}.amv-reinforce-pages button:disabled{opacity:.35;cursor:default}.amv-reinforce-count{margin:0;font-size:.7rem;color:#9daec1}.amv-reinforce-enabled .item-selector{min-width:0}.amv-reinforce-enabled .item-list{min-height:70px}@media(max-width:768px){.amv-reinforce-enabled .item-selector{height:360px;min-height:360px}}
    `;document.head.append(style);
    function walk(vnode,visit,components=false,seen=new Set()){if(!vnode||typeof vnode!=='object'||seen.has(vnode))return;seen.add(vnode);visit(vnode);if(components&&vnode.component)walk(vnode.component.subTree,visit,components,seen);if(Array.isArray(vnode.children))vnode.children.forEach(child=>walk(child,visit,components,seen));if(vnode.suspense)walk(vnode.suspense.activeBranch,visit,components,seen);}
    function hasClass(vnode,name){const value=vnode?.props?.class;return typeof value==='string'?value.split(/\s+/).includes(name):Array.isArray(value)?value.some(part=>typeof part==='string'?part.split(/\s+/).includes(name):part&&typeof part==='object'&&part[name]):!!value&&typeof value==='object'&&!!value[name];}
    function related(item){const found=new Set(),add=key=>{if(Object.hasOwn(elements,key)&&key!=='none')found.add(key);};add(item.element);for(const [key,value]of Object.entries(item.element_coeffs||{}))if(Number.isFinite(value)&&value>1)add(key);for(const map of [item.element_coeff_levels,item.affinity_bonus])for(const [key,value]of Object.entries(map||{}))if(Number.isFinite(value)&&value>0)add(key);for(const map of [item.base_stats,item.override_stats,item.effective_stats])for(const [key,value]of Object.entries(map||{}))if(key.startsWith('amplify_')&&Number.isFinite(value)&&value>0)add(key.slice(8));return found;}
    function attach(instance,panel){
      if(typeof instance.render!=='function')return;const original=instance.render,selector=panel.querySelector('.reinforce-layout .item-selector');if(!selector)return;const assistant=createReinforceAssistant(instance,panel,bridge,queueSync);let character='';try{character=sessionStorage.getItem(ACTIVE)||'current';}catch{character='current';}const pinKey='aether-bag-pins-v1:'+character;function readPins(){try{const value=JSON.parse(localStorage.getItem(pinKey)||'[]');return new Set(Array.isArray(value)?value.filter(uuid=>typeof uuid==='string'):[]);}catch{return new Set();}}let pins=readPins();
      const tools=element('div',undefined,'amv-reinforce-tools'),search=element('input'),stars=element('div',undefined,'amv-reinforce-chips'),elementRow=element('div',undefined,'amv-reinforce-chips'),slotRow=element('div',undefined,'amv-reinforce-chips'),count=element('p',undefined,'amv-reinforce-count'),pages=element('div',undefined,'amv-reinforce-pages'),pageLabel=element('span'),previous=button('上一页',()=>changePage(-1)),next=button('下一页',()=>changePage(1)),clear=button('清空',reset);tools.dataset.amvReinforceFilter='';pages.dataset.amvReinforcePages='';search.type='search';search.placeholder='搜索强化装备名称…';search.setAttribute('aria-label','搜索强化装备');previous.dataset.amvReinforcePrev='';next.dataset.amvReinforceNext='';tools.append(search,slotRow,stars,elementRow,count);pages.append(previous,pageLabel,next);
      let page=0,query='',timer=null,disposed=false,snapshot={mode:'backpack',total:0,matched:0,pages:1,stars:[],ready:false},signature='';const selectedStars=new Set(),selectedElements=new Set(),selectedSlots=new Set();
      for(const [key,[label,icon,color]]of Object.entries(elements)){const choice=button(undefined,()=>toggle(selectedElements,key));choice.dataset.amvReinforceElement=key;choice.style.setProperty('--amv-chip',color);const glyph=element('i',undefined,'mdi '+icon);glyph.setAttribute('aria-hidden','true');choice.append(glyph,element('span',label));choice.setAttribute('aria-label',label);elementRow.append(choice);}clear.dataset.amvReinforceClear='';elementRow.append(clear);
      slotRow.append(element('span','部位'));for(const [key,[label,icon]]of Object.entries(GEAR_SLOTS)){const choice=button('',()=>toggle(selectedSlots,key)),glyph=element('i',undefined,'mdi '+icon);glyph.setAttribute('aria-hidden','true');choice.append(glyph,element('span',label));choice.dataset.amvReinforceSlot=key;choice.setAttribute('aria-label',label+'部位');slotRow.append(choice);}
      function refresh(){if(!disposed&&!instance.isUnmounted)instance.proxy?.$forceUpdate();}
      function toggle(set,value){set.has(value)?set.delete(value):set.add(value);page=0;refresh();}
      function changePage(step){page=Math.max(0,Math.min(snapshot.pages-1,page+step));selector.querySelector('.item-list')?.scrollTo(0,0);refresh();}
      function reset(){clearTimeout(timer);query='';search.value='';selectedStars.clear();selectedElements.clear();selectedSlots.clear();page=0;refresh();}
      search.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{query=search.value.trim().toLocaleLowerCase();page=0;refresh();},120);});
      function render(...args){const vnode=original.apply(this,args);assistant.capture(vnode);let fragment=null,all=null;try{
        let mode=null,list=null;walk(vnode,node=>{if(hasClass(node,'source-toggle')&&['backpack','equipped'].includes(node.props?.modelValue))mode=node.props.modelValue;if(hasClass(node,'item-list'))list=node;});
        if(mode!=='backpack'){snapshot={...snapshot,mode,ready:false};queueSync();return vnode;}
        fragment=list?.children?.find(node=>Array.isArray(node?.children)&&node.patchFlag===128);all=fragment?.children;if(!Array.isArray(all)||fragment.dynamicChildren?.length){snapshot={...snapshot,mode,ready:false};queueSync();return vnode;}
        const rows=all.map(row=>{const chip=Array.isArray(row.children)&&row.children.find(child=>child?.type?.__name==='ItemChip');if(!hasClass(row,'chip-row-wrapper')||typeof row.key!=='string'||!row.key.startsWith('bp-')||!chip?.props?.item)throw new Error('官网装备列表结构已变更');return {row,item:chip.props.item};});
        const matched=rows.filter(({item})=>{const star=Number.isFinite(item.rarity)?item.rarity:0;if(query&&!String(item.name||'').toLocaleLowerCase().includes(query)||selectedStars.size&&!selectedStars.has(star))return false;if(selectedSlots.size&&!selectedSlots.has(equipmentSlot(item)))return false;if(!selectedElements.size)return true;const values=related(item);return [...selectedElements].some(value=>value==='none'?values.size===0:values.has(value));}).sort((a,b)=>Number(pins.has(b.item.uuid))-Number(pins.has(a.item.uuid)));
        const totalPages=Math.max(1,Math.ceil(matched.length/PAGE_SIZE));page=Math.max(0,Math.min(page,totalPages-1));snapshot={mode,total:rows.length,matched:matched.length,pages:totalPages,stars:[...new Set(rows.map(({item})=>Number.isFinite(item.rarity)?item.rarity:0))].sort((a,b)=>a-b),ready:true,unknownSlot:rows.some(({item})=>equipmentSlot(item)==='none')};
        // 只裁剪本次渲染的行，保留官网原始物品、选中状态、点击回调和强化请求。
        fragment.children=matched.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map(({row})=>row);queueSync();return vnode;
      }catch{if(fragment&&all)fragment.children=all;snapshot={...snapshot,ready:false};queueSync();return vnode;}}
      function sync(){if(disposed||!panel.isConnected)return;assistant.sync();const list=selector.querySelector('.item-list');if(list){if(tools.nextElementSibling!==list)list.before(tools);if(pages.previousElementSibling!==list)list.after(pages);}else{if(!selector.contains(tools))selector.append(tools);if(!selector.contains(pages))selector.append(pages);}tools.hidden=pages.hidden=!snapshot.ready||snapshot.mode!=='backpack';panel.classList.toggle('amv-reinforce-enabled',snapshot.ready&&snapshot.mode==='backpack');if(tools.hidden)return;
        const value=snapshot.stars.join(',');if(signature!==value){signature=value;stars.replaceChildren();for(const star of snapshot.stars){const choice=button(star>0?star+'★':'未标星',()=>toggle(selectedStars,star));choice.dataset.amvReinforceStar=star;choice.style.setProperty('--amv-chip',rarities[star]||'#9ea3b0');stars.append(choice);}}for(const choice of stars.children)choice.setAttribute('aria-pressed',String(selectedStars.has(Number(choice.dataset.amvReinforceStar))));for(const choice of slotRow.querySelectorAll('[data-amv-reinforce-slot]')){choice.setAttribute('aria-pressed',String(selectedSlots.has(choice.dataset.amvReinforceSlot)));choice.hidden=choice.dataset.amvReinforceSlot==='none'&&!snapshot.unknownSlot;}for(const choice of elementRow.querySelectorAll('[data-amv-reinforce-element]'))choice.setAttribute('aria-pressed',String(selectedElements.has(choice.dataset.amvReinforceElement)));const text=snapshot.matched?'符合 '+snapshot.matched+' / '+snapshot.total+' 件':'没有符合条件的装备';if(count.textContent!==text)count.textContent=text;const label=(page+1)+' / '+snapshot.pages;if(pageLabel.textContent!==label)pageLabel.textContent=label;previous.disabled=page===0;next.disabled=page>=snapshot.pages-1;
      }
      function dispose(){disposed=true;assistant.dispose();clearTimeout(timer);if(instance.render===render)instance.render=original;tools.remove();pages.remove();panel.classList.remove('amv-reinforce-enabled');}
      const controller={instance,panel,sync,dispose,pinKey,reloadPins(){const value=readPins();if(value.size===pins.size&&[...value].every(uuid=>pins.has(uuid)))return;pins=value;page=0;refresh();}};controllers.add(controller);instance.render=render;refresh();return controller;
    }
    let scheduled=false;function syncAll(){scheduled=false;for(const controller of controllers)if(controller.instance.isUnmounted||!controller.panel.isConnected){controller.dispose();controllers.delete(controller);}if(root.querySelector('.reinforce-layout')&&[...root.querySelectorAll('.reinforce-layout')].some(layout=>![...controllers].some(controller=>controller.panel.contains(layout))))walk(root.__vue_app__?._container?._vnode,vnode=>{const instance=vnode.component,panel=instance?.subTree?.el;if(instance?.type?.__name==='ReinforcerPanel'&&panel?.nodeType===1&&![...controllers].some(controller=>controller.instance===instance))attach(instance,panel);},true);controllers.forEach(controller=>controller.sync());}
    function queueSync(){if(!scheduled){scheduled=true;requestAnimationFrame(syncAll);}}new MutationObserver(records=>{if(records.some(record=>{const target=record.target.nodeType===1?record.target:null;if(target?.closest('.amv-reinforce-tools,.amv-reinforce-pages'))return false;if(target?.closest('.reinforce-layout'))return true;return [...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1&&(node.matches('.reinforce-layout')||node.querySelector('.reinforce-layout')));}))queueSync();}).observe(root,{childList:true,subtree:true});window.addEventListener('storage',event=>{for(const controller of controllers)if(event.key===null||event.key===controller.pinKey)controller.reloadPins();});window.addEventListener('aether-pin-change',event=>{for(const controller of controllers)if(controller.pinKey==='aether-bag-pins-v1:'+event.detail?.character)controller.reloadPins();});syncAll();
  }
  function initBackpackFilters(){
    const guard=Symbol.for('aether.backpack.filters');if(window[guard])return;window[guard]=true;
    const root=document.getElementById('app');if(!root)return;
    const elements={fire:['火','mdi-fire','#ff7a5c'],water:['水','mdi-water','#62d1ff'],lightning:['雷','mdi-lightning-bolt','#ffd451'],earth:['地','mdi-terrain','#9bd36e'],wind:['风','mdi-weather-windy','#6eeedc'],light:['光','mdi-white-balance-sunny','#f9ffb5'],dark:['暗','mdi-moon-waning-crescent','#a98bff'],none:['未标注','mdi-circle-outline','#a3acbb']},rarityColors={1:'#9ea3b0',2:'#6ddc8e',3:'#5db8ff',4:'#c47aff',5:'#ffc84a',6:'#ff5b5b'},controllers=new Set(),revision='__aetherBagFilterRevision';
    const style=element('style');style.id='aether-backpack-filter-style';style.textContent=`
      .bag-card .bag-header .amv-bag-inventory{display:inline-flex;align-items:center;gap:5px;flex:none;margin:0 auto 0 10px;padding:4px 9px;border:1px solid #78cfc52b;border-radius:6px;background:#67c9c30c;color:#a7d8d3;font:inherit;font-size:12px;line-height:1.5;cursor:pointer}.bag-card .bag-header .amv-bag-inventory:hover{color:#bff3e9;border-color:#78cfc57a;background:#67c9c31a}.bag-card .bag-header .amv-bag-inventory:focus-visible{outline:2px solid #87d9c3;outline-offset:2px}.amv-bag-inventory i{font-size:15px}.bag-card .bag-tabs.amv-bag-tabs{flex-wrap:wrap}.amv-bag-filter{flex:0 0 100%;min-width:0;display:flex;flex-direction:column;gap:7px;margin-top:4px;font:inherit;color:inherit}.amv-bag-filter[hidden],.amv-bag-filter [hidden]{display:none!important}.amv-bag-filter *{box-sizing:border-box}.amv-bag-filter button,.amv-bag-filter input{margin:0;font:inherit}.amv-bag-filter button{cursor:pointer;border:1px solid #ffffff0d;border-radius:6px;padding:3px 7px;background:#ffffff04;color:#aab7c7;line-height:1.5;font-size:.73rem}.amv-bag-filter button:hover{background:#ffffff0b}.amv-bag-filter button[aria-pressed=true]{color:var(--amv-chip,#87d9c3);border-color:var(--amv-chip,#87d9c3);background:#ffffff09}.amv-bag-filter button:focus-visible,.amv-bag-filter input:focus-visible,.amv-bag-pin:focus-visible{outline:2px solid #87d9c3;outline-offset:2px}.amv-bag-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.amv-bag-head input{flex:1 1 130px;min-width:90px;padding:5px 8px;background:#080f1b55;border:1px solid #ffffff12;border-radius:6px;color:inherit;font-size:.76rem}.amv-bag-count{color:#94a7b7;font-size:.69rem;white-space:nowrap}.amv-bag-details{display:flex;flex-direction:column;gap:6px}.amv-bag-row{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.amv-bag-row>span{min-width:30px;font-size:.72rem;color:#8ea0b3}.amv-bag-row button{color:var(--amv-chip,#aab7c7);display:inline-flex;align-items:center;gap:3px}.amv-bag-row i{font-size:.8rem}.amv-bag-notice{margin:0;color:#d7ba78;font-size:.7rem}.amv-bag-pin{position:absolute;right:-5px;bottom:-5px;z-index:8;display:grid;place-items:center;width:20px;height:20px;padding:0!important;margin:0!important;border:1px solid #ffffff19;border-radius:6px;background:#172434;color:#8f9eb0;font-size:12px;line-height:1;opacity:0;cursor:pointer}.bag-grid-item:hover>.amv-bag-pin,.bag-grid-item:focus-within>.amv-bag-pin,.amv-bag-pin[aria-pressed=true],.amv-bag-pin-mode .amv-bag-pin{opacity:1}.amv-bag-pin svg{width:14px;height:14px;pointer-events:none}.amv-bag-pin[aria-pressed=true] [data-pin-head]{fill:currentColor}.amv-bag-pin[aria-pressed=true]{color:#f4cd79;background:#30312c}.amv-bag-pin-mode .bag-grid-item:has(>.amv-bag-pin){outline:1px solid #ffffff12;cursor:pointer}.amv-bag-selling .amv-bag-pin{display:none!important}.amv-bag-filter[inert]{opacity:.6}@media(pointer:coarse){.amv-bag-pin{opacity:1}}
    `;document.head.append(style);
    function walk(vnode,visit,seen=new Set()){if(!vnode||typeof vnode!=='object'||seen.has(vnode))return;seen.add(vnode);visit(vnode);if(vnode.component)walk(vnode.component.subTree,visit,seen);if(Array.isArray(vnode.children))vnode.children.forEach(child=>walk(child,visit,seen));if(vnode.suspense)walk(vnode.suspense.activeBranch,visit,seen);}
    function category(item){return item?.effect_type==='skill_grant'?'skill':item?.effect_type==='prism_talent'?'prism':'other';}
    function skillMap(){const map=new Map(),status=root.__vue_app__?.config?.globalProperties?.$pinia?._s?.get('player')?.statusData;for(const slot of Object.values(status?.skills?.available||{}))for(const row of slot?.options||[])if(typeof row?.skill_code==='string')map.set(row.skill_code,row);return map;}
    function related(item,kind,skills){const found=new Set(),add=value=>{if(Object.hasOwn(elements,value)&&value!=='none')found.add(value);},positive=map=>{if(map&&typeof map==='object')for(const [key,value]of Object.entries(map))if(Number.isFinite(value)&&value>0)add(key);},requirements=value=>{if(Array.isArray(value)){for(const row of value)if(typeof row?.key==='string'&&row.key.startsWith('affinities.')&&Number.isFinite(row.required)&&row.required>0)add(row.key.slice(11));}else if(value&&typeof value==='object')positive(value.affinities||value);};add(item?.element);if(kind==='equipment'){for(const [key,value]of Object.entries(item?.element_coeffs||{}))if(Number.isFinite(value)&&value>1)add(key);positive(item?.element_coeff_levels);positive(item?.affinity_bonus);for(const stats of [item?.base_stats,item?.override_stats,item?.effective_stats])for(const [key,value]of Object.entries(stats||{}))if(key.startsWith('amplify_')&&Number.isFinite(value)&&value>0)add(key.slice(8));}else if(item?.effect_type==='skill_grant'){const info=skills.get(item.skill_grant);add(item.skill?.damage_type);add(info?.skill?.damage_type);requirements(info?.requirement);requirements(item?.requirement);}else if(!(item?.effect_type==='prism_talent'&&Object.hasOwn(item,'element')&&item.element===null))requirements(item?.requirement);return found;}
    function character(){try{return sessionStorage.getItem(ACTIVE)||'current';}catch{return 'current';}}
    function load(key,fallback){try{const value=JSON.parse(localStorage.getItem(key)||'null');return value??fallback;}catch{return fallback;}}
    function attach(instance,bag){
      const props=instance.props,keys=['backpackEquipment','backpackConsumables'];if(!props||keys.some(key=>!Array.isArray(props[key])||!Object.getOwnPropertyDescriptor(props,key)?.configurable||Object.getOwnPropertyDescriptor(props,key)?.get))return;
      const who=character(),pinKey='aether-bag-pins-v1:'+who,viewKey='aether-bag-view-v1:'+who,stored=load(viewKey,{}),sources=new Map(keys.map(key=>[key,props[key]])),old=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(props,key)])),state={enabled:true,failed:false,pinMode:false,expanded:stored.expanded!==false,kind:'equipment',selling:false};let pins=load(pinKey,[]);pins=new Set(Array.isArray(pins)?pins.filter(value=>typeof value==='string').slice(0,2000):[]);
      const views={};for(const kind of ['equipment','consumables']){const value=stored[kind]||{};views[kind]={q:typeof value.q==='string'?value.q.slice(0,200):'',stars:new Set(Array.isArray(value.stars)?value.stars.filter(Number.isFinite):[]),elements:new Set(Array.isArray(value.elements)?value.elements.filter(key=>Object.hasOwn(elements,key)):[]),slots:new Set(Array.isArray(value.slots)?value.slots.filter(key=>Object.hasOwn(GEAR_SLOTS,key)):[]),type:['skill','prism','other'].includes(value.type)?value.type:'all'};}
      const tabs=bag.querySelector('.bag-tabs');if(!tabs)return;const bar=element('section',undefined,'amv-bag-filter'),head=element('div',undefined,'amv-bag-head'),search=element('input'),count=element('span',undefined,'amv-bag-count'),details=element('div',undefined,'amv-bag-details'),notice=element('p',undefined,'amv-bag-notice'),kindRow=element('div',undefined,'amv-bag-row'),starRow=element('div',undefined,'amv-bag-row'),elementRow=element('div',undefined,'amv-bag-row'),slotRow=element('div',undefined,'amv-bag-row');bar.dataset.amvBagFilter='';search.type='search';search.setAttribute('aria-label','搜索背包物品');search.placeholder='搜索装备名称\u2026';notice.hidden=true;let queryTimer=null,lastStars='',currentKind='';
      const findInventory=button('',event=>{event.preventDefault();event.stopPropagation();try{const target=window.top;target.dispatchEvent(new target.CustomEvent('aether-inventory-search',{detail:{character:sessionStorage.getItem(ACTIVE)||''}}));}catch{window.dispatchEvent(new CustomEvent('aether-inventory-search'));}});findInventory.dataset.amvInventoryOpen='';findInventory.className='amv-bag-inventory';findInventory.title='查找各角色已缓存的物品';findInventory.setAttribute('aria-label','查找物品');const findIcon=element('i',undefined,'mdi mdi-magnify');findIcon.setAttribute('aria-hidden','true');findInventory.append(findIcon,element('span','查找物品'));
      function persist(){try{localStorage.setItem(viewKey,JSON.stringify({expanded:state.expanded,...Object.fromEntries(Object.entries(views).map(([kind,value])=>[kind,{q:value.q,stars:[...value.stars],elements:[...value.elements],slots:[...value.slots],type:value.type}]))}));}catch{}}
      function filtered(kind){const full=sources.get(kind==='equipment'?'backpackEquipment':'backpackConsumables');void props[revision];if(!state.enabled||!full)return full;try{const value=views[kind],skills=skillMap(),query=value.q.trim().toLocaleLowerCase(),active=query||value.stars.size||value.elements.size||kind==='equipment'&&value.slots.size||kind==='consumables'&&value.type!=='all';if(!active&&(kind!=='equipment'||!pins.size))return full;let rows=full.filter(item=>{if(!item||typeof item!=='object')return false;if(query&&!String(item.name||'').toLocaleLowerCase().includes(query))return false;if(value.stars.size&&!value.stars.has(Number.isFinite(item.rarity)?item.rarity:0))return false;if(kind==='equipment'&&value.slots.size&&!value.slots.has(equipmentSlot(item)))return false;if(kind==='consumables'&&value.type!=='all'&&category(item)!==value.type)return false;if(value.elements.size){const set=related(item,kind,skills);if(![...value.elements].some(key=>key==='none'?!set.size:set.has(key)))return false;}return true;});if(kind==='equipment'&&pins.size)rows=[...rows.filter(item=>pins.has(item.uuid)),...rows.filter(item=>!pins.has(item.uuid))];return rows;}catch{state.failed=true;return full;}}
      function resetPages(){walk(instance.subTree,vnode=>{if((vnode.type?.name||vnode.type?.__name)==='VPagination'&&vnode.props?.modelValue!==1){const update=vnode.props?.['onUpdate:modelValue'];if(typeof update==='function')update(1);else if(Array.isArray(update))update.forEach(fn=>typeof fn==='function'&&fn(1));}});}
      function changed(reset=true){if(reset)resetPages();props[revision]++;persist();sync();}
      function togglePin(uuid){if(state.selling)return;if(pins.has(uuid))pins.delete(uuid);else pins.add(uuid);try{localStorage.setItem(pinKey,JSON.stringify([...pins]));}catch{}notifyPinChange(who,uuid,pins.has(uuid));changed();}
      const expand=button('筛选',()=>{state.expanded=!state.expanded;persist();sync();}),pinMode=button('管理置顶',()=>{state.pinMode=!state.pinMode;sync();}),clear=button('清空',()=>{const value=views[state.kind];value.q='';value.stars.clear();value.elements.clear();value.slots.clear();value.type='all';search.value='';changed();});expand.dataset.amvBagExpand='';pinMode.dataset.amvBagPinMode='';clear.dataset.amvBagClear='';head.append(search,expand,pinMode,clear,count);kindRow.append(element('span','分类'));for(const [key,label]of [['all','全部'],['skill','技能书'],['prism','光谱'],['other','其他']]){const choice=button(label,()=>{views.consumables.type=key;changed();});choice.dataset.amvBagType=key;kindRow.append(choice);}starRow.append(element('span','星级'));elementRow.append(element('span','元素'));for(const [key,[label,icon,color]]of Object.entries(elements)){const choice=button('',()=>{const set=views[state.kind].elements;set.has(key)?set.delete(key):set.add(key);changed();}),glyph=element('i',undefined,'mdi '+icon);glyph.setAttribute('aria-hidden','true');choice.append(glyph,element('span',label));choice.dataset.amvBagElement=key;choice.style.setProperty('--amv-chip',color);choice.setAttribute('aria-label',label+'元素');elementRow.append(choice);}elementRow.title='装备按元素修正、元素强化和亲和加成筛选；消耗品按元素、技能属性和亲和需求筛选，兼容官网需求列表；未标注不会按名称猜测。';slotRow.append(element('span','部位'));for(const [key,[label,icon]]of Object.entries(GEAR_SLOTS)){const choice=button('',()=>{const set=views.equipment.slots;set.has(key)?set.delete(key):set.add(key);changed();}),glyph=element('i',undefined,'mdi '+icon);glyph.setAttribute('aria-hidden','true');choice.append(glyph,element('span',label));choice.dataset.amvBagSlot=key;choice.setAttribute('aria-label',label+'部位');slotRow.append(choice);}details.append(kindRow,slotRow,starRow,elementRow);bar.append(head,details,notice);tabs.classList.add('amv-bag-tabs');tabs.append(bar);
      search.addEventListener('input',()=>{clearTimeout(queryTimer);const kind=state.kind,value=search.value.slice(0,200);queryTimer=setTimeout(()=>{views[kind].q=value;changed();},120);});
      function selectCard(event){if(!state.pinMode||state.selling||state.kind!=='equipment')return;const cell=event.target.closest('.bag-grid-item[data-amv-bag-uuid]');if(!cell||!bag.contains(cell))return;event.preventDefault();event.stopImmediatePropagation();togglePin(cell.dataset.amvBagUuid);}
      bag.addEventListener('click',selectCard,true);
      function cells(){const full=sources.get('backpackEquipment'),ids=new Map(full.filter(item=>typeof item?.uuid==='string').map(item=>[item.uuid,item]));walk(instance.subTree,vnode=>{if(typeof vnode.key!=='string'||!ids.has(vnode.key))return;let cell=null;walk(vnode,node=>{if(!cell&&node.el?.nodeType===1&&node.el.classList.contains('bag-grid-item')&&bag.contains(node.el))cell=node.el;});if(!cell)return;const item=ids.get(vnode.key);window[Symbol.for('aether.equipment.hover.compare')]?.bind(cell,item);cell.dataset.amvBagUuid=item.uuid;let pin=cell.querySelector(':scope > .amv-bag-pin');if(!pin){pin=button('',event=>{event.preventDefault();event.stopImmediatePropagation();togglePin(cell.dataset.amvBagUuid);});pin.className='amv-bag-pin';const ns='http://www.w3.org/2000/svg',icon=document.createElementNS(ns,'svg'),head=document.createElementNS(ns,'path'),stem=document.createElementNS(ns,'path');icon.setAttribute('viewBox','0 0 20 20');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','1.4');icon.setAttribute('stroke-linecap','round');icon.setAttribute('stroke-linejoin','round');icon.setAttribute('aria-hidden','true');head.setAttribute('d','M7 3h6l-1 5 3 4v2H5v-2l3-4Z');head.setAttribute('data-pin-head','');stem.setAttribute('d','M10 14v4');icon.append(head,stem);pin.append(icon);for(const type of ['pointerdown','mousedown','touchstart','touchend','contextmenu','dblclick'])pin.addEventListener(type,event=>event.stopPropagation());cell.append(pin);}const chosen=pins.has(item.uuid),label=(chosen?'取消置顶 ':'置顶 ')+(item.name||'装备');pin.title=label;pin.setAttribute('aria-label',label);pin.setAttribute('aria-pressed',String(chosen));});}
      function sync(){if(instance.isUnmounted||!bag.isConnected)return;const bagHeader=bag.querySelector('.bag-header'),bagTitle=bagHeader?.querySelector('h1,h2,h3,.bag-title');if(bagHeader&&!bagHeader.contains(findInventory)){if(bagTitle)bagTitle.after(findInventory);else bagHeader.prepend(findInventory);}const index=[...tabs.querySelectorAll(':scope > .bag-tab')].findIndex(node=>node.classList.contains('bag-tab--active'));state.kind=['equipment','materials','consumables'][index]||'equipment';bar.hidden=state.kind==='materials';state.selling=!!bag.querySelector('.bag-icon-btn--sell,.sell-mode-banner');if(state.selling){clearTimeout(queryTimer);queryTimer=null;if(state.kind!=='materials')search.value=views[state.kind].q;}bar.inert=state.selling||state.failed;bag.classList.toggle('amv-bag-selling',state.selling);bag.classList.toggle('amv-bag-pin-mode',state.pinMode&&state.kind==='equipment'&&!state.selling);if(!bar.hidden){const value=views[state.kind];if(currentKind!==state.kind){currentKind=state.kind;search.value=value.q;}search.placeholder=state.kind==='equipment'?'搜索装备名称\u2026':'搜索消耗品名称\u2026';pinMode.hidden=state.kind!=='equipment';pinMode.setAttribute('aria-pressed',String(state.pinMode));expand.setAttribute('aria-expanded',String(state.expanded));details.hidden=!state.expanded;kindRow.hidden=state.kind!=='consumables';slotRow.hidden=state.kind!=='equipment';const source=sources.get(state.kind==='equipment'?'backpackEquipment':'backpackConsumables'),stars=[...new Set(source.map(item=>Number.isFinite(item?.rarity)?item.rarity:0))].sort((a,b)=>a-b),signature=state.kind+':'+stars.join(',');if(lastStars!==signature){lastStars=signature;starRow.querySelectorAll('button').forEach(node=>node.remove());for(const star of stars){const choice=button(star>0?star+'\u2605':'未标星',()=>{const set=views[state.kind].stars;set.has(star)?set.delete(star):set.add(star);changed();});choice.dataset.amvBagStar=star;choice.style.setProperty('--amv-chip',rarityColors[star]||'#9ea3b0');starRow.append(choice);}}for(const choice of slotRow.querySelectorAll('button')){choice.setAttribute('aria-pressed',String(value.slots.has(choice.dataset.amvBagSlot)));choice.hidden=choice.dataset.amvBagSlot==='none'&&!source.some(item=>equipmentSlot(item)==='none');}for(const choice of starRow.querySelectorAll('button'))choice.setAttribute('aria-pressed',String(value.stars.has(Number(choice.dataset.amvBagStar))));for(const choice of elementRow.querySelectorAll('button'))choice.setAttribute('aria-pressed',String(value.elements.has(choice.dataset.amvBagElement)));for(const choice of kindRow.querySelectorAll('button'))choice.setAttribute('aria-pressed',String(value.type===choice.dataset.amvBagType));const rows=filtered(state.kind),next='显示 '+rows.length+' / '+source.length;if(count.textContent!==next)count.textContent=next;notice.hidden=!state.selling&&!state.failed;notice.textContent=state.failed?'背包筛选暂不可用，正在显示官网原始列表。':state.selling?'出售模式下暂停调整筛选和置顶，请先退出出售模式。':'';}cells();}
      function dispose(){clearTimeout(queryTimer);state.enabled=false;try{props[revision]++;for(const key of keys)Object.defineProperty(props,key,{...old.get(key),value:sources.get(key)});delete props[revision];}catch{}bag.removeEventListener('click',selectCard,true);findInventory.remove();bar.remove();tabs.classList.remove('amv-bag-tabs');bag.querySelectorAll('.amv-bag-pin').forEach(node=>node.remove());}
      try{
        // 仅为背包组件提供筛选后的视图，来源数组和物品对象保持原样。
        Object.defineProperty(props,revision,{value:0,writable:true,configurable:true,enumerable:false});for(const [key,kind]of [['backpackEquipment','equipment'],['backpackConsumables','consumables']])Object.defineProperty(props,key,{enumerable:true,configurable:true,get:()=>filtered(kind),set:value=>{sources.set(key,Array.isArray(value)?value:[]);queueSync();}});for(const key of keys){const source=sources.get(key);props[key]=source.slice();props[key]=source;}props[revision]++;
      }catch{dispose();return;}
      const controller={instance,bag,sync,dispose,pinKey,reloadPins(){const value=load(pinKey,[]);pins=new Set(Array.isArray(value)?value.filter(key=>typeof key==='string'):[]);changed();}};controllers.add(controller);sync();return controller;
    }
    let scheduled=false;function syncAll(){scheduled=false;for(const controller of controllers)if(!controller.bag.isConnected||controller.instance.isUnmounted){controller.dispose();controllers.delete(controller);}if(root.querySelector('.bag-card')&&[...root.querySelectorAll('.bag-card')].some(node=>![...controllers].some(controller=>controller.bag===node)))walk(root.__vue_app__?._container?._vnode,vnode=>{const instance=vnode.component,bag=instance?.subTree?.el;if(instance?.type?.__name==='BackpackPanel'&&bag?.matches?.('.bag-card')&&![...controllers].some(controller=>controller.instance===instance))attach(instance,bag);});controllers.forEach(controller=>controller.sync());}
    function queueSync(){if(!scheduled){scheduled=true;requestAnimationFrame(syncAll);}}const observer=new MutationObserver(records=>{if(!records.some(record=>{const target=record.target.nodeType===1?record.target:null;if(target?.closest('.amv-bag-filter,.amv-bag-pin'))return false;if(target?.closest('.bag-card'))return true;return record.type==='childList'&&[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1&&(node.matches('.bag-card')||node.querySelector('.bag-card')));}))return;queueSync();});observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style']});window.addEventListener('storage',event=>{for(const controller of controllers)if(event.key===controller.pinKey)controller.reloadPins();});syncAll();
  }
  const ROLE_PREFERENCES_KEY='aether-role-preferences-v1';
  const ROLE_SYNC_CONFIG='aether-pin-sync-v1';
  function validRoleRecord(row){
    return typeof row?.key==='string'&&row.key.length<=100&&Number.isSafeInteger(row.stamp)&&row.stamp>=0&&
      /^[0-9a-f-]{36}$/.test(row.edit_id)&&(row.key?
        row.value===null||typeof row.value==='string'&&row.value.length<=80:
        Array.isArray(row.value)&&row.value.length<=200&&row.value.every(value=>typeof value==='string'&&value&&value.length<=100));
  }
  function rolePreferenceState(){
    try{
      const saved=JSON.parse(localStorage.getItem(ROLE_PREFERENCES_KEY)||'null');
      if(Array.isArray(saved?.records)&&saved.records.every(validRoleRecord))return {server:saved.server||'',records:saved.records};
      const order=Array.isArray(saved?.order)?[...new Set(saved.order.filter(value=>typeof value==='string'&&value))]:[];
      const notes=new Map(Object.entries(saved?.notes||{}).filter(([,value])=>typeof value==='string'&&value.trim()).map(([key,value])=>[key,value.trim().slice(0,80)]));
      if(order.length)notes.set('',order);
      const records=[...notes].map(([key,value])=>({key,value,stamp:0,edit_id:'00000000-0000-0000-0000-000000000000',dirty:true}));
      return {server:'',records:records.filter(validRoleRecord)};
    }catch{return {server:'',records:[]};}
  }
  function readRolePreferences(state=rolePreferenceState()){
    const data=new Map(state.records.map(row=>[row.key,row.value]));
    const order=data.get('')||[];
    data.delete('');
    return {order,notes:new Map([...data].filter(([,value])=>value!==null))};
  }
  function writeRoleState(state){
    const {order,notes}=readRolePreferences(state);
    localStorage.setItem(ROLE_PREFERENCES_KEY,JSON.stringify({...state,order,notes:Object.fromEntries(notes)}));
  }
  function editRolePreference(key,value){
    const state=rolePreferenceState(),current=state.records.find(row=>row.key===key);
    if(JSON.stringify(current?.value)===JSON.stringify(value))return;
    const row={key,value,stamp:Math.max(Date.now(),(current?.stamp||0)+1),edit_id:crypto.randomUUID(),dirty:true};
    if(!validRoleRecord(row))throw Error('账号排序或备注超出长度限制');
    state.records=[...state.records.filter(item=>item.key!==key),row];
    writeRoleState(state);
    window.dispatchEvent(new Event('aether-role-preferences-change'));
    window.dispatchEvent(new Event('aether-role-sync-now'));
  }

  function initPreferenceSync({key,read,write,valid,changeEvent,syncEvent,endpoint,label,statusKey,statusEvent}){
    const statusSymbol=Symbol.for(statusKey);
    let timer,busy=false,pending=false;
    function config(){
      try{
        const row=JSON.parse(localStorage.getItem(ROLE_SYNC_CONFIG)||'null'),url=new URL(row.server);
        return row.version===1&&row.initial===null&&url.origin===row.server&&
          (url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))&&
          /^[A-Za-z0-9_-]{32,128}$/.test(row.token)&&/^[A-Za-z0-9_-]{20,80}$/.test(row.client_id)?row:null;
      }catch{return null;}
    }
    function status(message){
      window[statusSymbol]=message;
      window.dispatchEvent(new CustomEvent(statusEvent,{detail:message}));
    }
    function schedule(delay=700){
      clearTimeout(timer);timer=setTimeout(synchronize,delay);
    }
    async function exchange(device){
      const snapshot=read();
      const waiting=snapshot.records.filter(row=>row.dirty||snapshot.server!==device.server);
      const changes=waiting.slice(0,100).map(({dirty,...row})=>row);
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
      let response,data;
      try{
        response=await fetch(device.server+endpoint,{
          method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',
          headers:{'Content-Type':'application/json','Authorization':'Bearer '+device.token},
          body:JSON.stringify({client_id:device.client_id,changes}),signal:controller.signal,
        });
        data=await response.json().catch(()=>({}));
      }finally{clearTimeout(timeout);}
      if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:label+'同步暂不可用');
      if(data.version!==1||!Array.isArray(data.records)||data.records.length>500||!data.records.every(valid))throw Error(label+'同步响应无效');
      const latest=config();
      if(latest?.token!==device.token||latest.server!==device.server||latest.client_id!==device.client_id)return;
      const current=read(),records=new Map(current.records.map(row=>[row.key,{...row,dirty:row.dirty||current.server!==device.server}]));
      for(const remote of data.records){
        const local=records.get(remote.key);
        if(!local||remote.stamp>local.stamp||remote.stamp===local.stamp&&remote.edit_id>=local.edit_id){
          records.set(remote.key,{...remote,dirty:false});
        }
      }
      const next={server:device.server,records:[...records.values()]};
      if(JSON.stringify(current)!==JSON.stringify(next)){
        write(next);window.dispatchEvent(new Event(changeEvent));
      }
      pending ||= next.records.some(row=>row.dirty);
      status(label+'已同步');
    }
    async function synchronize(){
      if(busy){pending=true;return;}
      const device=config();
      if(!device){status(label+'存于本机，绑定后会自动同步');return;}
      if(document.hidden){schedule(60000);return;}
      busy=true;pending=false;let failed=false;
      try{
        await navigator.locks.request(key+'-network',async()=>{
          if(config()?.token===device.token)await exchange(device);
        });
      }catch(error){
        failed=true;
        status((error.name==='AbortError'||error instanceof TypeError?label+'暂时无法连接 Web':error.message)+'，本机修改已保留');
      }finally{busy=false;schedule(!failed&&pending?700:60000);}
    }
    window.addEventListener(syncEvent,()=>schedule());
    window.addEventListener('online',()=>schedule(0));
    window.addEventListener('storage',event=>{if(event.key===ROLE_SYNC_CONFIG||event.key===key)schedule();});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
    schedule(1500);
  }

  function initRolePreferenceSync(){
    initPreferenceSync({
      key:ROLE_PREFERENCES_KEY,read:rolePreferenceState,write:writeRoleState,valid:validRoleRecord,
      changeEvent:'aether-role-preferences-change',syncEvent:'aether-role-sync-now',
      endpoint:'/api/aetheros/role-preferences/sync',label:'账号排序与备注',
      statusKey:'aether.role.sync.status',statusEvent:'aether-role-sync-status',
    });
  }

  const SUPPORT_PINS_KEY='aether-support-pins-v1';
  function validSupportPin(row){
    return validRoleRecord(row)&&row.key.length>0&&(row.value===null||row.value==='pinned');
  }
  function supportPinState(){
    const stored=JSON.parse(localStorage.getItem(SUPPORT_PINS_KEY)||'null');
    if(stored===null)return {server:'',records:[]};
    if(!Array.isArray(stored.records)||!stored.records.every(validSupportPin))throw Error('本机好友置顶数据无效');
    return stored;
  }
  function supportPins(){return new Set(supportPinState().records.filter(row=>row.value==='pinned').map(row=>row.key));}
  function toggleSupportPin(username){
    const state=supportPinState(),before=state.records.find(row=>row.key===username);
    const record={key:username,value:before?.value==='pinned'?null:'pinned',stamp:Math.max(Date.now(),(before?.stamp||0)+1),edit_id:crypto.randomUUID(),dirty:true};
    if(!validSupportPin(record))throw Error('好友账号标识无效');
    state.records=[...state.records.filter(row=>row.key!==username),record];
    localStorage.setItem(SUPPORT_PINS_KEY,JSON.stringify(state));
    window.dispatchEvent(new Event('aether-support-pins-change'));
    window.dispatchEvent(new Event('aether-support-sync-now'));
  }
  function initSupportPinSync(){
    initPreferenceSync({
      key:SUPPORT_PINS_KEY,read:supportPinState,write:state=>localStorage.setItem(SUPPORT_PINS_KEY,JSON.stringify(state)),
      valid:validSupportPin,changeEvent:'aether-support-pins-change',syncEvent:'aether-support-sync-now',
      endpoint:'/api/aetheros/support-pins/sync',label:'助战好友置顶',
      statusKey:'aether.support.sync.status',statusEvent:'aether-support-sync-status',
    });
  }

  function sortRoleRows(rows,order){
    const rank=new Map(order.map((username,index)=>[username,index]));
    return [...rows].sort((a,b)=>(rank.get(a.username)??order.length)-(rank.get(b.username)??order.length));
  }

  function initOfficialRolePreferences(){
    const root=document.querySelector('#app');
    if(!root)return;
    const listSelector='.character-gateway .character-list';
    const controllers=new WeakMap();
    const style=element('style');
    style.textContent=`
      .character-gateway .character-list.aether-inline-roles{position:relative;grid-template-columns:minmax(0,1fr)}
      .aether-inline-roles>:is(.aether-inline-role,.aether-inline-role-tools){grid-area:var(--aether-role-row)/1}
      .character-list .character-card.aether-inline-role{padding-inline-end:4.8rem}
      .aether-inline-role .character-card__body{overflow:hidden}
      .aether-inline-role .character-card__body>small{overflow-wrap:anywhere}
      .aether-inline-role-tools{
        display:flex;align-items:center;justify-self:end;align-self:center;gap:.38rem;z-index:1;
        margin-inline-end:.65rem;
      }
      .character-card .aether-inline-role-note{margin-inline-start:.34em;color:var(--accent,#93dece);font-size:.72em;font-weight:450;overflow-wrap:anywhere}
      .aether-inline-role-tools button{display:grid;place-items:center;width:1.9rem;height:1.9rem;padding:0;border-radius:.4rem;color:#a6b0c0;cursor:pointer}
      .aether-inline-role-tools button:is(:hover,[data-has-note=true]){color:var(--accent,#93dece)}
      .aether-inline-role-tools button:hover{background:#93c4ef12}
      .aether-inline-role-tools svg{width:1rem;height:1rem;fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}
      .aether-inline-role-tools button:focus-visible,.aether-inline-role-grip:focus-visible{outline:2px solid var(--accent,#93dece);outline-offset:1px}
      .aether-inline-role-grip{display:grid;place-items:center;width:1.1rem;min-height:1.9rem;flex:none;color:#a6b0c0;cursor:grab;touch-action:none;user-select:none}
      .aether-inline-role-grip::before{content:'';width:.6rem;height:.85rem;background:radial-gradient(circle,currentColor 1px,transparent 1.4px) 0 0/.3rem .27rem}
      .aether-inline-roles .character-card.aether-role-dragging{border-color:var(--accent,#93dece);background:#61f4de18}
      .aether-inline-role-grip:active{cursor:grabbing}
      .aether-role-note-dialog{
        position:fixed!important;inset:0!important;margin:auto!important;transform:none!important;
        box-sizing:border-box;width:min(365px,calc(100% - 28px));height:fit-content;max-height:calc(100% - 28px);
        overflow:auto;padding:1rem;border:1px solid #65c4c84d;border-radius:.8rem;background:#121c2c;
        color:#e6ecff;font:14px/1.5 system-ui;color-scheme:dark;box-shadow:0 12px 48px #0008;
      }
      .aether-role-note-dialog:not([open]){display:none!important}
      .aether-role-note-dialog::backdrop{background:rgba(3,8,18,.72)!important}
      .aether-role-note-dialog h2{margin:0 0 .65rem;font-size:1rem;overflow-wrap:anywhere}
      .aether-role-note-dialog input{box-sizing:border-box;width:100%;padding:.5rem;border:1px solid #80a9d045;border-radius:.4rem;background:#93c4ef12;color:inherit;font:inherit}
      .aether-role-note-dialog input:focus-visible,.aether-role-note-dialog button:focus-visible{outline:2px solid #93dece;outline-offset:1px}
      .aether-role-note-dialog footer{display:flex;justify-content:flex-end;gap:.5rem;margin-top:.8rem}
      .aether-role-note-dialog button{padding:.35rem .72rem;border:1px solid #7ccfb44a;border-radius:.42rem;color:inherit;background:#72d9b912;font:inherit;cursor:pointer}
      .aether-role-note-dialog button[type=submit]{color:#9debe0}
      @media(max-width:410px){.character-list .character-card.aether-inline-role{gap:.42rem;padding-inline-end:4.4rem}.aether-inline-role-tools{margin-inline-end:.45rem;gap:.18rem}}
    `;
    document.head.append(style);
    const dialog=element('dialog',undefined,'aether-role-note-dialog'),form=element('form'),title=element('h2'),input=element('input'),footer=element('footer');
    title.id='aether-role-note-title';dialog.setAttribute('aria-labelledby',title.id);
    input.type='text';input.maxLength=80;input.placeholder='输入备注';input.setAttribute('aria-label','备注');
    const cancel=button('取消',()=>dialog.close()),confirm=element('button','保存');confirm.type='submit';
    footer.append(cancel,confirm);form.append(title,input,footer);dialog.append(form);document.body.append(dialog);
    let saveNote;
    input.addEventListener('input',()=>input.setCustomValidity(''));
    form.addEventListener('submit',event=>{event.preventDefault();if(saveNote?.(input.value.trim()))dialog.close();});
    dialog.addEventListener('close',()=>{saveNote=null;});
    function editNote(name,note,save){
      title.textContent='编辑备注 · '+name;input.value=note;input.setCustomValidity('');saveNote=save;
      dialog.showModal();input.focus();input.select();
    }
    dialog.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();});

    function mount(list){
      const controls=new Map(),nativeOrder=new WeakMap(),animations=new WeakMap();
      const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
      let sequence=0,drag=null;
      list.classList.add('aether-inline-roles');

      function cards(){
        const entries=[];
        for(const card of list.querySelectorAll(':scope > button.character-card')){
          const body=card.querySelector('.character-card__body');
          const username=body?.querySelector(':scope > small')?.textContent.trim().match(/^(.+)\s+·\s+Lv\./)?.[1].trim();
          if(!username)continue;
          if(!nativeOrder.has(card))nativeOrder.set(card,sequence++);
          const nickname=body.querySelector('strong');
          const name=nickname&&[...nickname.childNodes].filter(node=>!node.classList?.contains('aether-inline-role-note')).map(node=>node.textContent).join('').trim();
          entries.push({card,nickname,username,name:name||username});
        }
        return entries.sort((a,b)=>nativeOrder.get(a.card)-nativeOrder.get(b.card));
      }

      function move(usernames,from,to){
        if(!from||!to||from===to)return;
        const start=usernames.indexOf(from),end=usernames.indexOf(to);
        if(start<0||end<0)return;
        usernames.splice(end,0,...usernames.splice(start,1));
        return true;
      }
      function saveOrder(usernames){
        const preferences=readRolePreferences();
        const order=[...usernames,...preferences.order.filter(username=>!usernames.includes(username))];
        try{editRolePreference('',order);}catch{}
      }

      function trackDrag(event){
        if(!drag||event.pointerId!==drag.pointer)return;
        if(!drag.moved&&Math.abs(drag.y-event.clientY)<=5)return;
        const y=event.clientY-list.getBoundingClientRect().top+list.scrollTop;
        const target=cards().find(({card})=>y>=card.offsetTop&&y<card.offsetTop+card.offsetHeight);
        if(move(drag.order,drag.username,target?.username)){drag.moved=true;apply(true);}
      }

      function stopDrag(event){
        if(!drag||event.pointerId!==drag.pointer)return;
        const {order,moved}=drag;drag=null;
        if(event.type==='pointerup'&&moved)saveOrder(order);
        apply(true);
      }

      function createControls({username,name}){
        const tools=element('div',undefined,'aether-inline-role-tools');
        const pencil=button('',()=>editNote(name,readRolePreferences().notes.get(username)||'',value=>{
          try{editRolePreference(username,value||null);apply();return true;}
          catch{input.setCustomValidity('无法保存备注，请检查浏览器存储。');input.reportValidity();return false;}
        }));
        pencil.title='编辑备注';pencil.setAttribute('aria-label','编辑 '+name+' 的备注');
        const icon=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS(icon.namespaceURI,'path');
        icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');
        path.setAttribute('d','M13.5 6.5l4 4M4 20l4.6-1 11-11a1.4 1.4 0 0 0 0-2l-1.6-1.6a1.4 1.4 0 0 0-2 0l-11 11L4 20z');
        icon.append(path);pencil.append(icon);
        const grip=element('span',undefined,'aether-inline-role-grip');
        grip.tabIndex=0;grip.title='拖动排序，也可按上下方向键';
        grip.setAttribute('role','slider');grip.setAttribute('aria-orientation','vertical');
        grip.setAttribute('aria-label',name+'的排序位置');grip.setAttribute('aria-valuemin','1');
        grip.addEventListener('pointerdown',event=>{
          if(!event.isPrimary||event.button!==0)return;
          event.preventDefault();grip.focus();
          grip.setPointerCapture(event.pointerId);
          drag={username,pointer:event.pointerId,y:event.clientY,moved:false,order:sortRoleRows(cards(),readRolePreferences().order).map(row=>row.username)};
        });
        grip.addEventListener('pointermove',trackDrag);
        for(const type of ['pointerup','pointercancel','lostpointercapture'])grip.addEventListener(type,stopDrag);
        grip.addEventListener('keydown',event=>{
          const keys=['ArrowUp','ArrowDown','Home','End'];
          if(!keys.includes(event.key))return;
          event.preventDefault();
          const roles=sortRoleRows(cards(),readRolePreferences().order),index=roles.findIndex(row=>row.username===username);
          const next=event.key==='Home'?0:event.key==='End'?roles.length-1:index+(event.key==='ArrowUp'?-1:1);
          const order=roles.map(row=>row.username);
          if(move(order,username,order[next])){saveOrder(order);apply(true);}
          grip.scrollIntoView({block:'nearest'});
        });
        tools.append(pencil,grip);list.append(tools);
        return {tools,pencil,grip};
      }

      function apply(animate=false){
        const preferences=readRolePreferences(),entries=sortRoleRows(cards(),drag?.order||preferences.order);
        const positions=new Map();
        if(animate&&!reducedMotion.matches){
          for(const {card,username} of entries){
            for(const node of [card,controls.get(username)?.tools]){
              if(!node)continue;
              positions.set(node,node.getBoundingClientRect().top);
              animations.get(node)?.cancel();
            }
          }
        }
        const present=new Set(entries.map(row=>row.username));
        for(const [username,control] of controls)if(!present.has(username)){control.tools.remove();controls.delete(username);}
        // 保留官网按钮及其事件监听器，备注输入框和拖动控件作为同一视觉行的独立元素。
        let next=list.querySelector(':scope > button.character-card');
        entries.forEach((row,index)=>{
          const {card,nickname,username}=row;
          if(card!==next)list.insertBefore(card,next);
          next=card.nextElementSibling;
          let control=controls.get(username);
          if(!control?.tools.isConnected){control=createControls(row);controls.set(username,control);}
          card.classList.add('aether-inline-role');
          card.classList.toggle('aether-role-dragging',Boolean(drag?.moved&&drag.username===username));
          for(const item of [card,control.tools])item.style.setProperty('--aether-role-row',index+1);
          control.grip.setAttribute('aria-valuemax',entries.length);
          control.grip.setAttribute('aria-valuenow',index+1);
          const note=preferences.notes.get(username),badge=nickname?.querySelector('.aether-inline-role-note');
          control.pencil.dataset.hasNote=!!note;
          if(!note)badge?.remove();
          else if(!badge)nickname?.append(element('small','('+note+')','aether-inline-role-note'));
          else if(badge.textContent!=='('+note+')')badge.textContent='('+note+')';
        });
        for(const [node,top] of positions){
          const delta=top-node.getBoundingClientRect().top;
          if(Math.abs(delta)>1)animations.set(node,node.animate([{transform:`translateY(${delta}px)`},{transform:'translateY(0)'}],{duration:185,easing:'cubic-bezier(.2,.7,.25,1)'}));
        }
      }
      return apply;
    }

    let scheduled=false;
    function scan(){
      scheduled=false;
      for(const list of root.querySelectorAll(listSelector)){
        if(!controllers.has(list))controllers.set(list,mount(list));
        controllers.get(list)();
      }
    }
    function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(scan);}}
    const relevant=node=>node.nodeType===1&&(node.matches('.character-list,.character-card,.character-gateway')||node.querySelector('.character-list'));
    new MutationObserver(records=>{
      if(records.some(record=>record.target.parentElement?.closest(listSelector)||record.target.closest?.(listSelector)||
        [...record.addedNodes,...record.removedNodes].some(relevant)))schedule();
    }).observe(root,{subtree:true,childList:true,characterData:true});
    window.addEventListener('storage',event=>{if(event.key===ROLE_PREFERENCES_KEY)schedule();});
    window.addEventListener('aether-role-preferences-change',schedule);
    scan();
  }

  function initOfficialRoleNotes(){
    const app=document.querySelector('#app');
    if(!app)return;
    const surfaces='.op-name,.friend-name,.bpl-list,.tg-member';
    const badgeClass='aether-official-role-note';
    const style=element('style');
    style.textContent=`.aether-official-role-note{margin-inline-start:.35em;color:var(--accent,#93dece);font-size:.73em;font-weight:450;overflow-wrap:anywhere}`;
    document.head.append(style);
    function paint(node,username,notes,before=null){
      if(!node)return;
      const note=notes.get(username),badge=node.querySelector(':scope > .'+badgeClass);
      if(!note){badge?.remove();return;}
      const text='('+note+')';
      if(!badge)node.insertBefore(element('small',text,badgeClass),before);
      else if(badge.textContent!==text)badge.textContent=text;
    }
    function scan(){
      const notes=readRolePreferences().notes,active=sessionStorage.getItem(ACTIVE);
      for(const name of app.querySelectorAll('.status-card--operator .op-name'))paint(name,active,notes);
      for(const name of app.querySelectorAll('.friend-list .friend-name')){
        const id=name.querySelector('.friend-username');
        const user=id?.textContent.trim().match(/(?:^|\s)@([^@]+)$/)?.[1].trim();
        paint(name.querySelector('.friend-remark')||name,user,notes,name.querySelector('.friend-remark')?null:id);
      }
      if(!document.querySelector('.bpl-list,.tg-member'))return;
      // 选择器的卡片不渲染账号名，从官网 Vue 列表的稳定 key 和账号字段拿身份。
      function visit(vnode,users){
        if(!vnode||typeof vnode!=='object')return;
        const component=vnode.component,kind=component?.type?.__name;
        if(kind==='BattlerPickList'){
          users=new Map((component.props.items||[]).map(item=>{
            const key=item.key,variant=item.cardProps?.badge?.variant;
            const username=key==='self'?active:variant==='npc'||variant==='preset'||String(key).startsWith('npc:')?null:item.meta?.username;
            return [key,username];
          }));
        }else if(kind==='BattlerPickCard'){
          paint(vnode.el?.querySelector?.('.bpc-name'),users?.get(vnode.key),notes);
          return;
        }else if(vnode.el?.nodeType===1&&vnode.el.classList.contains('tg-member')){
          const key=String(vnode.key||'');
          paint(vnode.el.querySelector('.tg-member-name'),key==='self'?active:key.startsWith('friend:')?key.slice(7):null,notes);
          return;
        }
        if(component)visit(component.subTree,users);
        else if(vnode.suspense)visit(vnode.suspense.activeBranch,users);
        else if(Array.isArray(vnode.children))for(const child of vnode.children)visit(child,users);
      }
      visit(app._vnode);
    }
    let scheduled=false;
    const schedule=()=>{if(!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;scan();});}};
    const added=node=>node.nodeType===1&&(node.matches(surfaces)||node.querySelector(surfaces));
    new MutationObserver(records=>{
      if(records.some(record=>record.target.parentElement?.closest(surfaces)||record.target.closest?.(surfaces)||[...record.addedNodes].some(added)))schedule();
    }).observe(document.body,{childList:true,characterData:true,subtree:true});
    window.addEventListener('storage',event=>{if(event.key===ROLE_PREFERENCES_KEY)schedule();});
    window.addEventListener('aether-role-preferences-change',schedule);
    scan();
  }

  function supportFriend(item){
    const variant=item?.cardProps?.badge?.variant,key=String(item?.key||'');
    if(!item?.meta?.username||item.meta.pin||['self','preset','npc','dungeon_npc','character','owned'].includes(variant)||
      key==='self'||/^(preset|npc):/.test(key))return '';
    return item.meta.username;
  }

  function initSupportPicker(){
    const app=document.querySelector('#app');if(!app)return;
    const settingsKey='aether-support-view-v1',controllers=new WeakMap();
    let preference;
    try{preference=JSON.parse(localStorage.getItem(settingsKey)||'null');}catch{}
    let view=preference?.view==='table'?'table':'rows';
    const style=element('style');
    style.textContent=`
      .aether-support-tools{display:flex;align-items:center;flex-wrap:wrap;gap:.4rem;margin:.45rem 0 .65rem;font-size:.78rem}
      .aether-support-tools button{padding:.28rem .58rem;border:1px solid #8399b63d;border-radius:.4rem;background:#91abd00a;color:inherit;font:inherit;cursor:pointer}
      .aether-support-tools button[aria-pressed=true]{color:var(--accent,#93dece);border-color:var(--accent,#93dece);background:#61f4de12}
      .aether-support-status{font-size:.74rem;color:var(--accent,#93dece);margin:.3rem 0}
      .aether-support-status:empty{display:none}
      .bpl-list.aether-support-list{position:relative}
      .aether-support-pin{display:grid;place-items:center;z-index:1;width:2rem;height:2rem;border:0;border-radius:.4rem;background:#152332;color:#a7b4c6;font:1rem/1 system-ui;cursor:pointer}
      .aether-support-pin[aria-pressed=true]{color:#ffc84a;background:#ffc84a17}
      .bpl-list>.aether-support-pin{position:absolute;inset-inline-end:.35rem}
      .aether-support-pin:focus-visible,.aether-support-tools button:focus-visible{outline:2px solid var(--accent,#93dece);outline-offset:2px}
      .bpl-list:has(>.aether-support-pin) .bpc-go{visibility:hidden}
      .bpl-list[data-aether-view=table]{display:none!important}
      .aether-support-grid-wrap[hidden]{display:none!important}
      .aether-support-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:.5rem}
      .aether-support-tile{position:relative;min-width:0;border:1px solid #8399b632;border-radius:.65rem;background:#91abd009}
      .aether-support-tile:hover{background:#61f4de0d;border-color:#61f4de5c}
      .aether-support-tile[data-disabled=true]{opacity:.45}
      .aether-support-grid .aether-support-choose{
        display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.45rem;width:100%;height:100%;
        min-height:6.5rem;padding:1rem .4rem .6rem;border:0;border-radius:.65rem;background:transparent;
        color:inherit;font:inherit;text-align:center;cursor:pointer;
      }
      .aether-support-choose:disabled{cursor:default}
      .aether-support-choose:focus-visible{outline:2px solid var(--accent,#93dece);outline-offset:1px}
      .aether-support-choose img,.aether-support-avatar{
        display:grid;place-items:center;flex:none;width:2.15rem;height:2.15rem;object-fit:cover;
        border-radius:.6rem;background:#93c4ef19;color:#b7d4ec;font-size:1rem;
      }
      .aether-support-choose strong{font-size:.78rem;font-weight:600;line-height:1.45;overflow-wrap:anywhere}
      .aether-support-tile>.aether-support-pin{position:absolute;inset-block-start:.12rem;inset-inline-end:.12rem;width:1.5rem;height:1.5rem;background:transparent}
    `;document.head.append(style);
    function saveView(){localStorage.setItem(settingsKey,JSON.stringify({view}));schedule();}

    function mount(component,root){
      const toolbar=element('div',undefined,'aether-support-tools'),rows=button('行显示',()=>{view='rows';saveView();}),table=button('平铺显示',()=>{view='table';saveView();});
      const feedback=element('p',undefined,'aether-support-status');
      toolbar.append(rows,table);
      const anchor=root.querySelector('.bpl-toolbar');if(anchor)anchor.after(toolbar);else root.prepend(toolbar);
      toolbar.after(feedback);
      const wrapper=element('div',undefined,'aether-support-grid-wrap');root.append(wrapper);
      let decorated=null,source=null,signature='',renderSignature='',renderedItems=[];
      const base=new WeakMap(),pinsByKey=new Map();
      function pinButton(item){
        const username=supportFriend(item);if(!username)return null;
        const pinned=supportPins().has(username);
        const pin=button(pinned?'★':'☆',()=>{
          try{toggleSupportPin(username);feedback.textContent='';schedule();}
          catch(error){feedback.textContent=error.message;}
        });
        pin.className='aether-support-pin';pin.setAttribute('aria-pressed',String(pinned));
        pin.setAttribute('aria-label',(pinned?'取消置顶 ':'置顶 ')+(item.meta.name||username));
        pin.title=(pinned?'取消置顶':'置顶好友')+' · '+username;
        return pin;
      }
      function update(){
        const pins=supportPins(),items=component.props.items||[],pinSignature=JSON.stringify([...pins].sort());
        if(items!==decorated||signature!==pinSignature){
          source=items===decorated?source:items;
          decorated=source.map(item=>{
            const original=base.get(item)||item,friend=supportFriend(original);
            if(!friend||!pins.has(friend))return original;
            const copy={...original,meta:{...original.meta,pin:100+(Number(original.meta.pin)||0)}};
            base.set(copy,original);return copy;
          });
          signature=pinSignature;component.props.items=decorated;
        }
        const total=Math.max(1,items.length);
        if(component.props.pageSize!==total)component.props.pageSize=total;
        rows.setAttribute('aria-pressed',String(view==='rows'));table.setAttribute('aria-pressed',String(view==='table'));
        const list=root.querySelector('.bpl-list');if(!list){wrapper.hidden=true;return;}
        list.classList.add('aether-support-list');list.dataset.aetherView=view;wrapper.hidden=view!=='table';
        const visible=[];
        function collect(vnode){
          if(!vnode||typeof vnode!=='object')return;
          if(vnode.component?.type?.__name==='AetherPager'){
            if(vnode.el?.nodeType===1)vnode.el.hidden=true;
            return;
          }
          if(vnode.component?.type?.__name==='BattlerPickCard'){visible.push(vnode);return;}
          if(vnode.component)collect(vnode.component.subTree);
          else if(Array.isArray(vnode.children))vnode.children.forEach(collect);
        }
        collect(component.subTree);
        const lookup=new Map(source.map(item=>[item.key,base.get(item)||item]));
        for(const [key,pin] of pinsByKey)if(!visible.some(vnode=>vnode.key===key)||view!=='rows'){pin.remove();pinsByKey.delete(key);}
        if(view==='rows'){
          for(const vnode of visible){
            const item=lookup.get(vnode.key),card=vnode.el;if(!card||!item)continue;
            let pin=pinsByKey.get(vnode.key);
            const username=supportFriend(item);if(!username)continue;
            const pressed=String(pins.has(username));
            if(!pin||pin.getAttribute('aria-pressed')!==pressed){pin?.remove();pin=pinButton(item);pinsByKey.set(vnode.key,pin);list.append(pin);}
            const top=card.offsetTop+8;
            if(pin.style.top!==top+'px')pin.style.top=top+'px';
          }
          return;
        }
        const data=visible.map(vnode=>lookup.get(vnode.key)).filter(Boolean);
        const stamp=JSON.stringify([pinSignature,[...readRolePreferences().notes]]);
        if(stamp===renderSignature&&data.length===renderedItems.length&&data.every((item,index)=>item===renderedItems[index]))return;
        renderSignature=stamp;renderedItems=data;
        const grid=element('div',undefined,'aether-support-grid');
        grid.setAttribute('aria-label','平铺角色列表');
        for(const item of data){
          const props=item.cardProps||{},tile=element('div',undefined,'aether-support-tile');
          const choose=button('',()=>component.emit('select',item.payload)),title=element('strong',props.name||item.meta?.name||item.key);
          const note=readRolePreferences().notes.get(supportFriend(item)||((item.key==='self')?sessionStorage.getItem(ACTIVE):''));
          if(note)title.append(element('small','('+note+')','aether-official-role-note'));
          if(props.avatar){const avatar=element('img');avatar.alt='';avatar.src=props.avatar;choose.append(avatar);}
          else{
            const avatar=element('span',(props.name||item.meta?.name||'?').slice(0,1),'aether-support-avatar');
            avatar.setAttribute('aria-hidden','true');choose.append(avatar);
          }
          choose.append(title);choose.className='aether-support-choose';choose.disabled=!!props.disabled;
          tile.dataset.disabled=String(!!props.disabled);tile.append(choose);
          const pin=pinButton(item);if(pin)tile.append(pin);
          grid.append(tile);
        }
        wrapper.replaceChildren(grid);
      }
      root.addEventListener('load',schedule,true);
      return {update,toolbar};
    }
    function scan(){
      scheduled=false;
      function visit(vnode){
        if(!vnode||typeof vnode!=='object')return;
        const component=vnode.component;
        if(component?.type?.__name==='BattlerPickList'){
          const root=component.subTree?.el;
          if(root?.matches?.('.bpl')&&root.isConnected){
            let controller=controllers.get(component);
            if(!controller?.toolbar.isConnected){controller=mount(component,root);controllers.set(component,controller);}
            controller.update();
          }
          return;
        }
        if(component)visit(component.subTree);
        else if(vnode.suspense)visit(vnode.suspense.activeBranch);
        else if(Array.isArray(vnode.children))vnode.children.forEach(visit);
      }
      try{visit(app._vnode);}catch(error){console.warn('AetherOS 助战列表',error);}
    }
    let scheduled=false;
    function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(scan);}}
    new MutationObserver(records=>{
      if(records.some(record=>record.target.closest?.('.bpl')||[...record.addedNodes].some(node=>node.nodeType===1&&(node.matches('.bpl')||node.querySelector('.bpl')))))schedule();
    }).observe(document.body,{childList:true,characterData:true,subtree:true});
    for(const event of ['aether-support-pins-change','aether-role-preferences-change'])window.addEventListener(event,schedule);
    window.addEventListener('storage',event=>{if([SUPPORT_PINS_KEY,settingsKey].includes(event.key)){try{const value=JSON.parse(localStorage.getItem(settingsKey)||'null');view=value?.view==='table'?'table':'rows';}catch{}schedule();}});
    window.addEventListener('resize',schedule);
    scan();
  }

  function paneContext(){
    if(window.parent===window)return null;
    try{if(window.name.startsWith(PREFIX)){const value=JSON.parse(window.name.slice(PREFIX.length));if(/^[a-z0-9-]{1,80}$/.test(value.id)&&typeof value.character==='string')return value;}}catch{}
    const query=new URLSearchParams(location.search),id=query.get('aether_mv_pane'),character=query.get('aether_mv_character');return id&&/^[a-z0-9-]{1,80}$/.test(id)&&character!==null?{id,character}:null;
  }
  const context=paneContext();
  if(context){
    try{
      // 同源内嵌页面会共享当前标签页的会话存储，仅隔离官网使用的角色键。
      const storage=window.sessionStorage,prototype=Storage.prototype,get=prototype.getItem,set=prototype.setItem,remove=prototype.removeItem,key=PREFIX+context.id;
      let character=context.character;const previous=get.call(storage,key);if(previous!==null){const value=JSON.parse(previous);if(typeof value==='string')character=value;}
      function notify(){context.character=character;window.name=PREFIX+JSON.stringify(context);window.parent.postMessage({type:CHANNEL,id:context.id,character},ORIGIN);}
      prototype.getItem=function(key){if(this===storage&&String(key)===ACTIVE)return character;return get.call(this,key);};
      prototype.setItem=function(name,value){if(this===storage&&String(name)===ACTIVE){character=String(value).trim();try{set.call(storage,key,JSON.stringify(character));}catch{}notify();return;}return set.call(this,name,value);};
      prototype.removeItem=function(name){if(this===storage&&String(name)===ACTIVE){character='';try{set.call(storage,key,'""');}catch{}notify();return;}return remove.call(this,name);};
      const activate=()=>window.parent.postMessage({type:CHANNEL,id:context.id,activate:true},ORIGIN);document.addEventListener('pointerdown',activate,true);document.addEventListener('focusin',activate,true);document.addEventListener('keydown',event=>{if(event.key==='Escape')window.parent.postMessage({type:CHANNEL,id:context.id,dismiss:true},ORIGIN);},true);
      set.call(storage,key,JSON.stringify(character));if(storage.getItem(ACTIVE)!==character)throw new Error('角色隔离未生效');notify();
      ready(initEquipmentHoverCompare);ready(initDecomposeLayout);ready(initSpectrumLevelTooltips);ready(initPluginSettings);ready(initOfficialRolePreferences);ready(initOfficialRoleNotes);ready(initSupportPicker);ready(initBackpackFilters);ready(initReinforceFilters);ready(initCustomLoadouts);
    }catch{
      window.stop();window.parent.postMessage({type:CHANNEL,id:context.id,error:true},ORIGIN);
      ready(()=>{const text=element('div','角色隔离未就绪，请关闭此区域后重开。');text.style.cssText='position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:#111b29;color:#e4edf5;font:14px sans-serif';document.body.append(text);});
    }
    return;
  }
  if(window.top!==window)return;
  ready(initEquipmentHoverCompare);ready(initBackpackFilters);ready(initReinforceFilters);
  ready(initDecomposeLayout);ready(initSpectrumLevelTooltips);ready(initPluginSettings);ready(initOfficialRolePreferences);ready(initOfficialRoleNotes);ready(initSupportPicker);ready(initCustomLoadouts);
  ready(initScriptUpdates);
  ready(initScriptNavigation);
  ready(initInventorySearch);ready(initPinSync);ready(initLoadoutSync);ready(initReinforceHistorySync);ready(initReinforceBulkRead);
  ready(initRolePreferenceSync);ready(initSupportPinSync);
  ready(()=>{
    if(document.getElementById('aether-multiview'))return;
    const style=element('style');style.textContent=`
#aether-multiview,#aether-multiview *{box-sizing:border-box}#aether-multiview[hidden],#aether-multiview [hidden]{display:none!important}#aether-multiview{position:fixed;inset:0;z-index:2147483600;display:flex;flex-direction:column;background:#101318;color:#e7e9ed;font:13px/1.5 'Segoe UI Variable','Segoe UI','Microsoft YaHei UI',system-ui,sans-serif;color-scheme:dark}#aether-multiview button,#aether-multiview-launch{appearance:none;margin:0;font:inherit;line-height:1.4;cursor:pointer;border:1px solid transparent;border-radius:7px;padding:6px 10px;color:inherit;background:#ffffff07;transition:background-color .14s,border-color .14s,opacity .14s}#aether-multiview button:hover{background:#ffffff10}#aether-multiview button:active{background:#ffffff09}#aether-multiview button:focus-visible,#aether-multiview select:focus-visible{outline:2px solid #92d8c6;outline-offset:2px}#aether-multiview button:disabled{opacity:.35;cursor:default}#aether-multiview select{margin:0}#aether-multiview svg.amv-control-icon{display:block;flex-shrink:0;width:16px;height:16px;pointer-events:none}#aether-multiview-launch{position:fixed;right:18px;bottom:18px;z-index:2147483500;padding:10px 14px;background:#242a32;color:#e7e9ed;border:1px solid #ffffff12;border-radius:10px;box-shadow:0 4px 16px #0003;font:13px 'Segoe UI',system-ui,sans-serif}html.amv-open #aether-multiview-launch,html.amv-open body>#app,html.amv-open body>.v-overlay-container{display:none!important}
#aether-multiview .amv-desktop{position:relative;isolation:isolate;flex:1;min-height:0;overflow:hidden;background:#101318}#aether-multiview .amv-pane{position:absolute;display:flex;flex-direction:column;min-width:0;overflow:hidden;border:1px solid #ffffff0d;border-radius:11px;background:#1b2027;box-shadow:0 5px 18px #0003}#aether-multiview .amv-pane[data-active=true]{border-color:#ffffff25;box-shadow:0 12px 36px #0005}#aether-multiview .amv-pane>header{display:flex;align-items:center;gap:4px;flex-shrink:0;min-height:40px;padding:0 5px 0 11px;background:#1e232a;border-bottom:1px solid #0002;cursor:grab;touch-action:none;user-select:none}#aether-multiview .amv-pane[data-active=true]>header{background:#262c34}#aether-multiview .amv-pane>header strong{flex:1;min-width:0;padding-left:4px;font-size:12px;font-weight:550;color:#c1c6ce;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#aether-multiview .amv-pane[data-active=true]>header strong{color:#f1f2f4}#aether-multiview .amv-pane>header small{flex:0 0 5px;width:5px;height:5px;margin:0 5px;border-radius:50%;overflow:hidden;font-size:0;background:#bca270}#aether-multiview .amv-pane.is-ready>header small{background:#85c8b5}#aether-multiview .amv-pane>header button.amv-control{display:grid;place-items:center;flex-shrink:0;width:28px;height:28px;padding:0;border:0;border-radius:5px;color:#aeb5bf;background:transparent}#aether-multiview .amv-pane>header button.amv-control:hover{background:#ffffff10;color:#fff}#aether-multiview .amv-pane>header button[data-icon=close]:hover{background:#c42b1c;color:#fff}#aether-multiview .amv-pane>header .amv-scale{width:58px;height:26px;max-width:58px;margin:0 3px;padding:1px 2px 1px 5px;border:1px solid #ffffff06;border-radius:5px;background:#ffffff03;color:#c8cdd5;font:11px 'Segoe UI',system-ui;cursor:pointer}#aether-multiview .amv-pane>header .amv-scale:hover{border-color:#ffffff16;background:#ffffff08}#aether-multiview .amv-pane:not(.is-ready) iframe,#aether-multiview.amv-moving iframe{pointer-events:none}#aether-multiview .amv-viewport{position:relative;flex:1;min-height:0;overflow:hidden}#aether-multiview iframe{position:absolute;inset:0 auto auto 0;display:block;width:calc(100% / var(--amv-scale,.5));height:calc(100% / var(--amv-scale,.5));border:0;background:#0b1320;transform:scale(var(--amv-scale,.5));transform-origin:0 0}
#aether-multiview .amv-roles,#aether-multiview .amv-snap-menu,#aether-multiview .amv-snap-assist{position:absolute;padding:18px;border:1px solid #ffffff12;border-radius:14px;background:#242930f5;-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);box-shadow:0 10px 32px #0005}#aether-multiview .amv-roles{z-index:20;left:10px;bottom:66px;width:min(430px,calc(100vw - 20px));max-height:min(65vh,600px);overflow:auto}#aether-multiview .amv-roles h2{margin:0 2px 5px;font-size:15px;font-weight:600;letter-spacing:-.02em}#aether-multiview .amv-status{margin:0 2px 15px;font-size:11px;color:#969fab}#aether-multiview .amv-role-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px}#aether-multiview .amv-role-list button{display:flex;align-items:center;gap:9px;min-width:0;padding:9px 7px;text-align:left;border:0;background:transparent}#aether-multiview .amv-role-list button:hover{background:#ffffff09}#aether-multiview .amv-role-copy{display:flex;flex:1;min-width:0;flex-direction:column;gap:2px}#aether-multiview .amv-role-copy strong{font-size:12px;font-weight:550;overflow-wrap:anywhere}#aether-multiview .amv-role-copy small{font-size:10px;color:#969fab;overflow-wrap:anywhere}#aether-multiview .amv-role-list button[data-open=true]:after{content:'';flex:0 0 5px;width:5px;height:5px;border-radius:50%;background:#87cdb9}#aether-multiview .amv-roles footer{display:flex;justify-content:flex-end;margin-top:14px;padding-top:12px;border-top:1px solid #ffffff09}#aether-multiview [data-amv-all]{padding:6px 12px;background:#8ed4bf;color:#14221e;font-size:12px;font-weight:550}#aether-multiview [data-amv-all]:hover{background:#a4e0ce}
#aether-multiview .amv-role-copy .amv-role-note{color:#a8d6c9;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#aether-multiview .amv-taskbar{position:relative;z-index:10;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;flex-shrink:0;min-height:58px;padding:5px 10px;border-top:1px solid #ffffff0a;background:#1d222ae8;-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px)}#aether-multiview .amv-taskbar>.amv-shell-control{display:grid;place-items:center;width:40px;height:40px;padding:0;border:0;border-radius:8px;background:transparent;color:#c2c9d2}#aether-multiview .amv-taskbar>.amv-shell-control svg{width:19px;height:19px}#aether-multiview .amv-taskbar>[data-amv-manage]{color:#a0d9c9}#aether-multiview .amv-taskbar>.amv-shell-control:hover,#aether-multiview .amv-taskbar>[aria-expanded=true]{background:#ffffff0b}#aether-multiview .amv-tasks{display:flex;align-items:center;justify-content:safe center;gap:4px;min-width:0;overflow-x:auto;scrollbar-width:thin;scrollbar-color:#ffffff20 transparent}#aether-multiview .amv-task{position:relative;flex:0 0 44px;width:44px;height:46px;display:grid;place-items:center;padding:3px 4px 7px;border:0;border-radius:8px;background:transparent}#aether-multiview .amv-task:hover{background:#ffffff08}#aether-multiview .amv-task[aria-pressed=true]{background:#ffffff0b}#aether-multiview .amv-task:after{content:'';position:absolute;left:calc(50% - 3px);bottom:2px;width:6px;height:3px;border-radius:3px;background:#8c96a3}#aether-multiview .amv-task[aria-pressed=true]:after{left:calc(50% - 7px);width:14px;background:#91d3c0}#aether-multiview .amv-task[data-minimized=true]{opacity:.55}#aether-multiview .amv-avatar{display:grid;place-items:center;position:relative;flex-shrink:0;width:32px;height:32px;border-radius:8px;overflow:hidden;background:#353c47;color:#d8dde5}#aether-multiview .amv-avatar img{display:block;width:100%;height:100%;margin:0;object-fit:cover}#aether-multiview .amv-avatar-fallback{font-size:15px;font-weight:550;line-height:1}#aether-multiview .amv-title-avatar{width:20px;height:20px;border-radius:5px;opacity:.9}#aether-multiview .amv-title-avatar .amv-avatar-fallback{font-size:11px}
#aether-multiview .amv-snap-menu,#aether-multiview .amv-snap-assist{z-index:30}#aether-multiview .amv-snap-menu{width:min(350px,calc(100vw - 16px));max-height:calc(100dvh - 80px);overflow:auto}#aether-multiview .amv-snap-menu>strong{display:block;font-size:12px;font-weight:550;margin-bottom:15px;color:#cdd3dc}#aether-multiview .amv-snap-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px 12px}#aether-multiview .amv-snap-card small{display:block;margin-top:7px;color:#9ca5b2;font-size:10px;line-height:1.5;text-align:center}#aether-multiview .amv-snap-mini{position:relative;height:48px}#aether-multiview .amv-snap-mini button{position:absolute;margin:0;padding:0;border:1px solid #ffffff0b;border-radius:3px;background:#56606e}#aether-multiview .amv-snap-mini button:hover,#aether-multiview .amv-snap-mini button:focus-visible{background:#93d1c0;border-color:#b2e1d3}#aether-multiview .amv-snap-mini button:disabled{opacity:.18}#aether-multiview .amv-snap-preview{position:absolute;z-index:2147483646;pointer-events:none;border:1px solid #95d9c6b3;border-radius:10px;background:#95d9c612}#aether-multiview .amv-snap-assist{left:50%;bottom:70px;transform:translateX(-50%);width:min(440px,calc(100vw - 16px));max-height:50vh;overflow:auto}#aether-multiview .amv-snap-assist header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;font-size:12px}#aether-multiview .amv-snap-assist header strong{font-weight:550}#aether-multiview .amv-snap-assist header button{padding:4px 9px;font-size:11px;color:#b9c4d0}#aether-multiview .amv-assist-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px}#aether-multiview .amv-assist-list button{display:flex;align-items:center;gap:9px;text-align:left;font-size:11px;overflow-wrap:anywhere;padding:9px 7px;border:0;background:transparent}#aether-multiview .amv-assist-list button:hover{background:#ffffff09}#aether-multiview .amv-assist-list .amv-avatar{width:28px;height:28px;border-radius:6px}#aether-multiview .amv-empty{margin:0;position:absolute;inset:0;display:grid;place-content:center;padding:32px;color:#7e8998;font-size:12px;text-align:center;pointer-events:none}
#aether-multiview .amv-handle{position:absolute;z-index:2;touch-action:none}#aether-multiview .amv-handle[data-edge=n],#aether-multiview .amv-handle[data-edge=s]{left:12px;right:12px;height:5px;cursor:ns-resize}#aether-multiview .amv-handle[data-edge=n]{top:0}#aether-multiview .amv-handle[data-edge=s]{bottom:0}#aether-multiview .amv-handle[data-edge=e],#aether-multiview .amv-handle[data-edge=w]{top:12px;bottom:12px;width:5px;cursor:ew-resize}#aether-multiview .amv-handle[data-edge=e]{right:0}#aether-multiview .amv-handle[data-edge=w]{left:0}#aether-multiview .amv-handle[data-edge=ne],#aether-multiview .amv-handle[data-edge=se],#aether-multiview .amv-handle[data-edge=sw],#aether-multiview .amv-handle[data-edge=nw]{width:12px;height:12px}#aether-multiview .amv-handle[data-edge=ne]{right:0;top:0;cursor:nesw-resize}#aether-multiview .amv-handle[data-edge=se]{right:0;bottom:0;cursor:nwse-resize}#aether-multiview .amv-handle[data-edge=se]:after{content:'';position:absolute;right:3px;bottom:3px;width:4px;height:4px;border-right:1px solid #a9b6c14d;border-bottom:1px solid #a9b6c14d}#aether-multiview .amv-handle[data-edge=sw]{left:0;bottom:0;cursor:nesw-resize}#aether-multiview .amv-handle[data-edge=nw]{left:0;top:0;cursor:nwse-resize}#aether-multiview .is-maximized .amv-handle{display:none}#aether-multiview.amv-moving{user-select:none}@media(prefers-reduced-motion:reduce){#aether-multiview button{transition:none}}@media(max-width:450px){#aether-multiview .amv-role-list{grid-template-columns:1fr}#aether-multiview .amv-taskbar{gap:4px;padding:5px 6px}#aether-multiview .amv-taskbar>.amv-shell-control{width:34px}#aether-multiview .amv-pane>header{gap:2px;padding-left:7px}#aether-multiview .amv-pane>header .amv-title-avatar{display:none}#aether-multiview-launch{right:12px;bottom:12px}}
    `;document.head.append(style);
    const launch=button('多角色同屏',open),root=element('section'),status=element('p','正在读取官网角色列表\u2026','amv-status'),roles=element('section',undefined,'amv-roles'),roleList=element('div',undefined,'amv-role-list'),stage=element('div',undefined,'amv-desktop'),taskbar=element('footer',undefined,'amv-taskbar'),tasks=element('div',undefined,'amv-tasks'),empty=element('p','点击底部\u201c打开角色\u201d选择账号；拖动标题栏移动，拖动边角调整大小。','amv-empty'),snapMenu=element('section',undefined,'amv-snap-menu'),snapList=element('div',undefined,'amv-snap-list'),preview=element('div',undefined,'amv-snap-preview'),assist=element('section',undefined,'amv-snap-assist'),assistHint=element('strong'),assistList=element('div',undefined,'amv-assist-list');launch.id='aether-multiview-launch';root.id='aether-multiview';root.hidden=true;roles.hidden=true;snapMenu.hidden=true;assist.hidden=true;preview.hidden=true;preview.setAttribute('aria-hidden','true');status.setAttribute('aria-live','polite');root.setAttribute('aria-label','Aether 多角色同屏');roles.setAttribute('aria-label','角色列表');stage.setAttribute('aria-label','角色桌面');taskbar.setAttribute('aria-label','角色窗口栏');snapMenu.setAttribute('aria-label','贴靠布局');snapMenu.setAttribute('role','dialog');stage.append(empty,preview);
    let characters=[],busy=false,active=false,loaded=false,previousInert=false,pending=null,activeId=null,gesture=null,z=0,snapOwner=null,snapTimer=null,snapCloseTimer=null,snapGroup=null;const panes=new Map(),timers=new Set();let config={scale:50,characters:null,windows:Object.create(null)};try{const value=JSON.parse(localStorage.getItem(CONFIG)||'null');if([40,50,60,75,100].includes(value?.scale))config.scale=value.scale;if(Array.isArray(value?.characters))config.characters=value.characters.filter(name=>typeof name==='string');if(value?.windows&&typeof value.windows==='object'&&!Array.isArray(value.windows))config.windows=Object.assign(Object.create(null),value.windows);}catch{}
    const manage=button('打开角色',()=>{if(!roles.hidden){closeMenus();return;}closeSnap();closeAssist();roles.hidden=false;manage.setAttribute('aria-expanded','true');preferences=readRolePreferences();renderRoles();}),all=button('打开全部',()=>{orderedRoles().forEach((row,index)=>openPane(row.username,index*400));closeMenus();}),close=button('退出桌面',leave),roleFooter=element('footer'),assistHeader=element('header');manage.dataset.amvManage='';manage.setAttribute('aria-expanded','false');all.dataset.amvAll='';close.dataset.amvClose='';manage.classList.add('amv-shell-control');manage.setAttribute('aria-label','打开角色');manage.title='打开角色';close.classList.add('amv-shell-control');close.setAttribute('aria-label','退出桌面');close.title='退出桌面';controlIcon(manage,'start');controlIcon(close,'exit');taskbar.append(manage,tasks,close);const checkUpdate=button('检查更新',()=>window.dispatchEvent(new Event('aether-userscript-check-updates')));checkUpdate.dataset.amvCheckUpdate='';const syncPins=button('数据同步',()=>window.dispatchEvent(new Event('aether-pins-settings')));syncPins.dataset.amvPinOpen='';roleFooter.append(element('span','v'+SCRIPT_VERSION,'amv-script-version'),syncPins,checkUpdate,all);roles.append(element('h2','Aether 多角色同屏'),status,roleList,roleFooter);snapMenu.append(element('strong','贴靠布局'),snapList);assistHeader.append(assistHint,button('完成',closeAssist));assist.append(assistHeader,assistList);root.append(stage,taskbar,roles,snapMenu,assist);document.body.append(root,launch);
    const clamp=(value,min,max)=>Math.max(min,Math.min(max,value)),bounds=()=>({w:stage.clientWidth,h:stage.clientHeight}),finite=(value,fallback)=>Number.isFinite(value)?value:fallback;
    function controlIcon(node,kind){if(node.dataset.icon===kind)return;const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),paths={minimize:'M5 10h10',maximize:'M5 5h10v10H5Z',restore:'M7 5V3h10v10h-2M3 7h10v10H3Z',reload:'M15 6A6 6 0 1 0 16 12M15 3v4h-4',close:'m5 5 10 10M15 5 5 15',start:'M3 3h5v5H3ZM12 3h5v5h-5ZM3 12h5v5H3ZM12 12h5v5h-5Z',exit:'M8 4H4v12h4m4-11 5 5-5 5M8 10h9'};svg.setAttribute('viewBox','0 0 20 20');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.25');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');svg.classList.add('amv-control-icon');const path=document.createElementNS(ns,'path');path.setAttribute('d',paths[kind]);svg.append(path);node.dataset.icon=kind;node.replaceChildren(svg);}
    function name(username){const row=characters.find(row=>row.username===username);return row?.name&&row.name!==username?row.name+' · '+username:username||'选择角色';}
    function fit(rect){const area=bounds(),w=clamp(finite(rect.w,760),Math.min(320,Math.max(1,area.w-16)),Math.max(1,area.w-16)),h=clamp(finite(rect.h,600),Math.min(220,Math.max(1,area.h-16)),Math.max(1,area.h-16));return {x:clamp(finite(rect.x,8),8,Math.max(8,area.w-w-8)),y:clamp(finite(rect.y,8),8,Math.max(8,area.h-h-8)),w,h};}
    function initial(index){const area=bounds();return fit({x:16+(index%8)*32,y:16+(index%8)*26,w:Math.min(760,area.w-32),h:Math.min(600,area.h-32)});}
    function save(){if(!loaded)return;config.characters=[...new Set([...panes.values()].map(pane=>pane.character))];for(const pane of panes.values())config.windows[pane.character]={...pane.rect,minimized:pane.minimized,maximized:pane.maximized,order:pane.order,scale:pane.scale,snap:pane.snap};try{localStorage.setItem(CONFIG,JSON.stringify(config));}catch{}}
    let preferences=readRolePreferences();
    const orderedRoles=()=>sortRoleRows(characters,preferences.order);
    function renderRoles(){
      roleList.replaceChildren();
      for(const row of orderedRoles()){
        const icon=element('span',undefined,'amv-avatar'),copy=element('span',undefined,'amv-role-copy');
        updateIcon(icon,row.username);copy.append(element('strong',row.name||row.username));
        if(row.name&&row.name!==row.username)copy.append(element('small',row.username));
        const existing=[...panes.values()].some(pane=>pane.character===row.username);
        const choice=button('',()=>{openPane(row.username);closeMenus();});
        const note=preferences.notes.get(row.username);
        if(note)copy.append(element('small',note,'amv-role-note'));
        choice.append(icon,copy);choice.setAttribute('aria-label',name(row.username));
        if(note)choice.setAttribute('aria-description',note);
        choice.title=[name(row.username),note,existing?'已打开':''].filter(Boolean).join(' · ');
        choice.disabled=!loaded;choice.dataset.amvRole=row.username;choice.dataset.open=existing;
        choice.setAttribute('aria-pressed',String(existing));roleList.append(choice);
      }
    }
    function refresh(){
      empty.hidden=panes.size>0;
      if(loaded)status.textContent=panes.size+' / '+characters.length+' 个角色窗口';
      if(!roles.hidden)renderRoles();
      for(const task of tasks.querySelectorAll('[data-amv-task]'))if(!panes.has(task.dataset.amvTask))task.remove();
      const opened=[...panes.values()];
      if(preferences.order.length){
        const rank=new Map(orderedRoles().map((row,index)=>[row.username,index]));
        opened.sort((a,b)=>(rank.get(a.character)??Infinity)-(rank.get(b.character)??Infinity));
      }
      opened.forEach((pane,index)=>{
        if(!pane.task){
          pane.task=button('',()=>{closeMenus();activate(pane.id,true);});
          pane.task.className='amv-task';pane.task.dataset.amvTask=pane.id;
          pane.taskIcon=element('span',undefined,'amv-avatar');pane.task.append(pane.taskIcon);
        }
        const current=tasks.children[index];
        if(pane.task!==current)tasks.insertBefore(pane.task,current||null);
        updateIcon(pane.taskIcon,pane.character);pane.task.dataset.minimized=pane.minimized;
        pane.task.setAttribute('aria-pressed',String(activeId===pane.id&&!pane.minimized));
        pane.task.setAttribute('aria-label',name(pane.character));
        const note=preferences.notes.get(pane.character);
        pane.task.title=[name(pane.character),note,pane.minimized?'已最小化':''].filter(Boolean).join(' · ');
      });
    }
    const refreshRolePreferences=()=>{preferences=readRolePreferences();if(active)refresh();};
    window.addEventListener('storage',event=>{if(event.key===ROLE_PREFERENCES_KEY)refreshRolePreferences();});
    window.addEventListener('aether-role-preferences-change',refreshRolePreferences);
    function paint(pane){const area=bounds(),rect=pane.maximized?{x:8,y:8,w:Math.max(1,area.w-16),h:Math.max(1,area.h-16)}:fit(pane.snap?zoneRect(pane.snap):pane.rect);pane.display=rect;pane.node.style.setProperty('--amv-scale',pane.scale/100);pane.scaleSelect.value=String(pane.scale);Object.assign(pane.node.style,{left:rect.x+'px',top:rect.y+'px',width:rect.w+'px',height:rect.h+'px',zIndex:pane.order});pane.node.hidden=pane.minimized;pane.node.dataset.active=String(activeId===pane.id&&!pane.minimized);pane.node.classList.toggle('is-maximized',pane.maximized);controlIcon(pane.maximize,pane.maximized?'restore':'maximize');updateIcon(pane.titleIcon,pane.character);pane.maximize.setAttribute('aria-label',(pane.maximized?'还原':'最大化')+' '+name(pane.character));}
    function layout(){panes.forEach(paint);positionSnap();if(snapGroup){const preset=presets.find(item=>item.id===snapGroup.layout),index=preset.zones.findIndex((_,i)=>!snapGroup.placed.has(i));if(index>=0)previewZone({layout:snapGroup.layout,index});}}
    function activate(id,restore=false){const pane=panes.get(id);if(!pane)return;if(restore)pane.minimized=false;if(pane.minimized)return;if(activeId!==id||restore){activeId=id;pane.order=++z;layout();refresh();save();}}
    function toggleMax(id){closeSnap();closeAssist();const pane=panes.get(id);if(!pane)return;pane.maximized=!pane.maximized;activate(id,true);layout();save();}
    const presets=[
      {id:'full',label:'铺满',zones:[[0,0,1,1]]},{id:'halves',label:'左右分屏',zones:[[0,0,.5,1],[.5,0,.5,1]]},{id:'wide',label:'左宽右窄',zones:[[0,0,2/3,1],[2/3,0,1/3,1]]},
      {id:'thirds',label:'三列',zones:[[0,0,1/3,1],[1/3,0,1/3,1],[2/3,0,1/3,1]]},{id:'center',label:'中间宽屏',zones:[[0,0,.25,1],[.25,0,.5,1],[.75,0,.25,1]]},{id:'rows',label:'上下分屏',zones:[[0,0,1,.5],[0,.5,1,.5]]},
      {id:'quarters',label:'四宫格',zones:[[0,0,.5,.5],[.5,0,.5,.5],[0,.5,.5,.5],[.5,.5,.5,.5]]},{id:'six',label:'六宫格',zones:Array.from({length:6},(_,i)=>[(i%3)/3,Math.floor(i/3)/2,1/3,.5])},{id:'nine',label:'九宫格',zones:Array.from({length:9},(_,i)=>[(i%3)/3,Math.floor(i/3)/3,1/3,1/3])}
    ];
    function validSnap(value){const preset=presets.find(item=>item.id===value?.layout);return preset&&Number.isInteger(value.index)&&preset.zones[value.index]?{layout:preset.id,index:value.index}:null;}
    function zoneRect(target){const value=validSnap(target),area=bounds();if(!value)return null;const [x,y,w,h]=presets.find(item=>item.id===value.layout).zones[value.index];return {x:8+(area.w-8)*x,y:8+(area.h-8)*y,w:(area.w-8)*w-8,h:(area.h-8)*h-8};}
    function canSnap(target){const rect=zoneRect(target);return rect&&rect.w>=Math.min(320,bounds().w-16)&&rect.h>=Math.min(220,bounds().h-16);}
    function previewZone(target){const rect=zoneRect(target);preview.hidden=!rect||!canSnap(target);if(rect)Object.assign(preview.style,{left:rect.x+'px',top:rect.y+'px',width:rect.w+'px',height:rect.h+'px'});}
    function closeSnap(){clearTimeout(snapTimer);clearTimeout(snapCloseTimer);snapMenu.hidden=true;snapOwner=null;preview.hidden=true;}
    function closeAssist(){assist.hidden=true;snapGroup=null;preview.hidden=true;}
    function closeMenus(){roles.hidden=true;manage.setAttribute('aria-expanded','false');closeSnap();closeAssist();}
    function avatar(character){const row=characters.find(item=>item.username===character);try{if(row?.avatar){const url=new URL(row.avatar,ORIGIN);if(url.protocol==='https:'&&!url.username&&!url.password)return url.href;}}catch{}return '';}
    function updateIcon(holder,character){const label=characters.find(item=>item.username===character)?.name||character||'?',url=avatar(character);if(holder.dataset.iconCharacter===character&&holder.dataset.iconUrl===url)return;holder.dataset.iconCharacter=character;holder.dataset.iconUrl=url;holder.replaceChildren();const fallback=element('span',Array.from(label).slice(0,1).join(''),'amv-avatar-fallback');holder.append(fallback);if(url){const picture=element('img');picture.alt='';picture.referrerPolicy='no-referrer';picture.draggable=false;picture.addEventListener('load',()=>{picture.hidden=false;fallback.hidden=true;});picture.addEventListener('error',()=>{picture.hidden=true;fallback.hidden=false;});picture.hidden=true;picture.src=url;holder.append(picture);}}
    function positionSnap(){if(snapMenu.hidden)return;const pane=panes.get(snapOwner);if(!pane||pane.minimized){closeSnap();return;}const anchor=pane.maximize.getBoundingClientRect(),width=snapMenu.offsetWidth,height=snapMenu.offsetHeight;let y=anchor.bottom+6;if(y+height>innerHeight-64)y=anchor.top-height-6;snapMenu.style.left=clamp(anchor.right-width,8,Math.max(8,innerWidth-width-8))+'px';snapMenu.style.top=clamp(y,8,Math.max(8,innerHeight-height-64))+'px';}
    function openSnap(id){const pane=panes.get(id);if(!pane||pane.minimized)return;clearTimeout(snapTimer);clearTimeout(snapCloseTimer);closeAssist();roles.hidden=true;manage.setAttribute('aria-expanded','false');snapOwner=id;activate(id);snapList.replaceChildren();for(const preset of presets){const card=element('div',undefined,'amv-snap-card'),mini=element('div',undefined,'amv-snap-mini');card.dataset.amvSnapLayout=preset.id;preset.zones.forEach(([x,y,w,h],index)=>{const target={layout:preset.id,index},choice=button('',()=>applySnap(id,target));choice.dataset.amvSnapZone=index;choice.setAttribute('aria-label',preset.label+'，'+(index+1)+'号位置');choice.title=preset.label+' · '+(index+1)+'号位置';choice.disabled=!canSnap(target);Object.assign(choice.style,{left:'calc('+x*100+'% + 1px)',top:'calc('+y*100+'% + 1px)',width:'calc('+w*100+'% - 2px)',height:'calc('+h*100+'% - 2px)'});choice.addEventListener('pointerenter',()=>previewZone(target));choice.addEventListener('focus',()=>previewZone(target));mini.append(choice);});card.append(mini,element('small',preset.label));snapList.append(card);}snapMenu.hidden=false;positionSnap();}
    function applySnap(id,target){const pane=panes.get(id);if(!pane||!canSnap(target))return;closeSnap();if(target.layout==='full'){closeAssist();pane.minimized=false;pane.maximized=true;activate(id,true);layout();save();return;}pane.minimized=false;pane.maximized=false;pane.snap={...target};pane.rect=zoneRect(target);activate(id,true);layout();save();snapGroup={layout:target.layout,placed:new Map([[target.index,id]])};renderAssist();}
    function renderAssist(){if(!snapGroup)return;const preset=presets.find(item=>item.id===snapGroup.layout),next=preset.zones.findIndex((_,index)=>!snapGroup.placed.has(index)),available=[...panes.values()].filter(pane=>![...snapGroup.placed.values()].includes(pane.id));if(next<0||!available.length){closeAssist();return;}assistHint.textContent=preset.label+' · 选择窗口填入 '+(next+1)+' 号位置';assistList.replaceChildren();for(const pane of available){const choice=button('',()=>{const target={layout:snapGroup.layout,index:next};if(!canSnap(target)){closeAssist();return;}pane.minimized=false;pane.maximized=false;pane.snap=target;pane.rect=zoneRect(target);snapGroup.placed.set(next,pane.id);activate(pane.id,true);layout();save();renderAssist();}),icon=element('span',undefined,'amv-avatar');choice.dataset.amvAssistPane=pane.id;updateIcon(icon,pane.character);choice.append(icon,element('span',name(pane.character)));assistList.append(choice);}assist.hidden=false;previewZone({layout:snapGroup.layout,index:next});}
    function dragTarget(event){const box=stage.getBoundingClientRect(),x=event.clientX-box.left,y=event.clientY-box.top;let target=null;if(x<24||x>box.width-24){const right=x>box.width/2;if(y<64||y>box.height-64)target={layout:'quarters',index:(y>box.height/2?2:0)+(right?1:0)};else target={layout:'halves',index:right?1:0};}else if(y<24)target={layout:'full',index:0};return target&&canSnap(target)?target:null;}
    function startGesture(event,pane,edge){if(event.button!==0||pane.maximized||gesture)return;if(!edge&&event.target.closest('button,input,select,a'))return;event.preventDefault();closeMenus();activate(pane.id);pane.snap=null;pane.rect={...pane.display};gesture={pane,edge,x:event.clientX,y:event.clientY,rect:{...pane.display},pointer:event.pointerId,target:event.currentTarget};gesture.target.setPointerCapture(event.pointerId);root.classList.add('amv-moving');}
    function moveGesture(event){if(!gesture||event.pointerId!==gesture.pointer)return;const {pane,edge,x,y,rect}=gesture,dx=event.clientX-x,dy=event.clientY-y,area=bounds();let next={...rect};if(!edge){next.x+=dx;next.y+=dy;}else{if(edge.includes('e'))next.w=clamp(rect.w+dx,Math.min(320,area.w-16),area.w-rect.x-8);if(edge.includes('s'))next.h=clamp(rect.h+dy,Math.min(220,area.h-16),area.h-rect.y-8);if(edge.includes('w')){next.x=clamp(rect.x+dx,8,rect.x+rect.w-Math.min(320,area.w-16));next.w=rect.x+rect.w-next.x;}if(edge.includes('n')){next.y=clamp(rect.y+dy,8,rect.y+rect.h-Math.min(220,area.h-16));next.h=rect.y+rect.h-next.y;}}pane.rect=fit(next);paint(pane);gesture.snapTarget=edge?null:dragTarget(event);previewZone(gesture.snapTarget);}
    function finishGesture(event){if(!gesture||event?.pointerId!==undefined&&event.pointerId!==gesture.pointer)return;const {target,pointer,pane,snapTarget}=gesture;gesture=null;if(target.hasPointerCapture(pointer))target.releasePointerCapture(pointer);root.classList.remove('amv-moving');preview.hidden=true;if(event?.type==='pointerup'&&snapTarget)applySnap(pane.id,snapTarget);else save();}
    function openPane(character,delay=0,restoring=false){const existing=[...panes.values()].find(pane=>pane.character===character);if(existing){activate(existing.id,true);return;}const id=crypto.randomUUID(),node=element('section',undefined,'amv-pane'),header=element('header'),caption=element('strong',name(character)),titleIcon=element('span',undefined,'amv-avatar amv-title-avatar'),state=element('small','载入中'),frame=element('iframe'),viewport=element('div',undefined,'amv-viewport'),minimize=button('\u2014',()=>{pane.minimized=true;activeId=null;const next=[...panes.values()].filter(value=>!value.minimized).sort((a,b)=>b.order-a.order)[0];if(next)activate(next.id);layout();refresh();save();}),maximize=button('\u25a1',()=>toggleMax(id)),scaleSelect=element('select'),reload=button('重载',()=>{pane.failed=false;pane.ready=false;node.classList.remove('is-ready');frame.inert=true;frame.tabIndex=-1;state.textContent='载入中';frame.src=frame.src;}),remove=button('×',()=>{finishGesture();save();node.remove();panes.delete(id);if(activeId===id)activeId=null;refresh();save();});node.dataset.amvPane=id;node.dataset.character=character;node.setAttribute('role','region');node.setAttribute('aria-label',name(character)+'的角色窗口');frame.title=name(character)+'的官方界面';frame.name=PREFIX+JSON.stringify({id,character});frame.referrerPolicy='same-origin';frame.inert=true;frame.tabIndex=-1;minimize.setAttribute('aria-label','最小化 '+name(character));remove.setAttribute('aria-label','关闭 '+name(character));maximize.dataset.amvMaximize=id;maximize.setAttribute('aria-haspopup','dialog');maximize.title='悬停选择贴靠布局；点击最大化；右键或向下键打开布局';caption.title=name(character);state.title='载入中';for(const [control,kind,label] of [[minimize,'minimize','最小化'],[maximize,'maximize','最大化'],[reload,'reload','重载'],[remove,'close','关闭']]){control.classList.add('amv-control');control.title=label;controlIcon(control,kind);}reload.setAttribute('aria-label','重载');maximize.title='悬停选择贴靠布局；点击最大化；右键或向下键打开布局';scaleSelect.className='amv-scale';scaleSelect.dataset.amvScale='';scaleSelect.setAttribute('aria-label','内容缩放 '+name(character));for(const value of [40,50,60,75,100]){const option=element('option',value+'%');option.value=value;scaleSelect.append(option);}scaleSelect.addEventListener('change',()=>{pane.scale=Number(scaleSelect.value);paint(pane);save();});header.append(titleIcon,caption,state,scaleSelect,minimize,maximize,reload,remove);viewport.append(frame);node.append(header,viewport);
      const saved=Object.hasOwn(config.windows,character)?config.windows[character]:null,rect=saved&&typeof saved==='object'?{x:finite(saved.x,16),y:finite(saved.y,16),w:finite(saved.w,760),h:finite(saved.h,600)}:initial(panes.size),pane={id,node,caption,titleIcon,state,frame,minimize,maximize,remove,scaleSelect,scale:[40,50,60,75,100].includes(saved?.scale)?saved.scale:config.scale,snap:validSnap(saved?.snap),character,rect,display:rect,minimized:restoring&&saved?.minimized===true,maximized:saved?.maximized===true,order:restoring?finite(saved?.order,++z):++z,failed:false,ready:false};z=Math.max(z,pane.order);panes.set(id,pane);stage.append(node);node.addEventListener('pointerdown',()=>activate(id));header.addEventListener('pointerdown',event=>startGesture(event,pane,''));header.addEventListener('dblclick',event=>{if(!event.target.closest('button,select'))toggleMax(id);});maximize.addEventListener('pointerenter',()=>{clearTimeout(snapCloseTimer);snapTimer=setTimeout(()=>openSnap(id),300);});maximize.addEventListener('pointerleave',()=>{clearTimeout(snapTimer);snapCloseTimer=setTimeout(closeSnap,200);});maximize.addEventListener('contextmenu',event=>{event.preventDefault();openSnap(id);});maximize.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();openSnap(id);}});
      for(const edge of ['n','e','s','w','ne','se','sw','nw']){const handle=element('div',undefined,'amv-handle');handle.dataset.edge=edge;handle.addEventListener('pointerdown',event=>startGesture(event,pane,edge));if(edge==='se'){handle.tabIndex=0;handle.setAttribute('role','button');handle.setAttribute('aria-label','调整窗口大小，方向键调整');handle.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)||pane.maximized)return;event.preventDefault();activate(id);pane.snap=null;pane.rect=fit({...pane.display,w:pane.display.w+(event.key==='ArrowRight'?16:event.key==='ArrowLeft'?-16:0),h:pane.display.h+(event.key==='ArrowDown'?16:event.key==='ArrowUp'?-16:0)});layout();save();});}node.append(handle);}
      frame.addEventListener('load',()=>{if(frame.getAttribute('src')&&!pane.failed)state.textContent=pane.ready?'已载入':'内嵌页未运行脚本，请检查油猴设置';state.title=state.textContent;});const timer=setTimeout(()=>{timers.delete(timer);if(!active||!panes.has(id))return;const url=new URL('/aether/',ORIGIN);url.searchParams.set('aether_mv_pane',id);url.searchParams.set('aether_mv_character',character);frame.src=url.href;},delay);timers.add(timer);if(!restoring)activate(id,true);layout();refresh();if(!restoring)save();
    }
    async function open(){if(busy||active)return;root.hidden=false;active=true;loaded=false;document.documentElement.classList.add('amv-open');const app=document.getElementById('app');previousInert=!!app?.inert;if(app)app.inert=true;busy=true;manage.disabled=all.disabled=true;roles.hidden=false;manage.setAttribute('aria-expanded','true');status.textContent='正在读取官网角色列表\u2026';renderRoles();const controller=new AbortController();pending=controller;const timeout=setTimeout(()=>controller.abort(),12000);
      try{const response=await fetch('/api/aether/account',{credentials:'same-origin',cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error(response.status===401?'请先在原官网登录，再打开多角色同屏。':'暂时无法读取角色列表，可返回单角色后重试。');const value=await response.json();if(!active||pending!==controller)return;if(value?.code!==0||!Array.isArray(value.data?.characters))throw new Error('官网角色列表格式发生变化，请返回单角色使用。');characters=[...new Map(value.data.characters.filter(row=>typeof row?.username==='string'&&row.username.trim()).map(row=>[row.username,row])).values()];const available=new Set(characters.map(row=>row.username)),selected=Array.isArray(config.characters)?[...new Set(config.characters.filter(character=>available.has(character)))]:[];selected.forEach((character,index)=>openPane(character,index*400,true));loaded=true;const top=[...panes.values()].filter(pane=>!pane.minimized).sort((a,b)=>b.order-a.order)[0];activeId=top?.id||null;roles.hidden=panes.size>0;manage.setAttribute('aria-expanded',String(!roles.hidden));layout();refresh();}catch(error){if(active&&pending===controller)status.textContent=error.name==='AbortError'?'读取角色列表超时，请返回单角色后重试。':error instanceof SyntaxError||error instanceof TypeError?'暂时无法读取官网角色列表，请稍后重试。':error.message;}finally{clearTimeout(timeout);if(pending===controller){pending=null;busy=false;manage.disabled=false;all.disabled=!loaded;}}}
    function leave(){closeMenus();finishGesture();save();active=false;loaded=false;pending?.abort();pending=null;busy=false;timers.forEach(clearTimeout);timers.clear();panes.forEach(pane=>pane.node.remove());panes.clear();tasks.replaceChildren();activeId=null;root.hidden=true;roles.hidden=true;document.documentElement.classList.remove('amv-open');const app=document.getElementById('app');if(app)app.inert=previousInert;launch.focus();}
    snapMenu.addEventListener('pointerenter',()=>clearTimeout(snapCloseTimer));snapMenu.addEventListener('pointerleave',()=>snapCloseTimer=setTimeout(closeSnap,200));root.addEventListener('pointerdown',event=>{if(!event.target.closest('.amv-snap-menu,.amv-snap-assist,.amv-roles,[data-amv-manage],[data-amv-maximize]'))closeMenus();});window.addEventListener('keydown',event=>{if(active&&event.key==='Escape')closeMenus();});
    window.addEventListener('pointermove',moveGesture);window.addEventListener('pointerup',finishGesture);window.addEventListener('pointercancel',finishGesture);window.addEventListener('blur',finishGesture);window.addEventListener('resize',()=>{if(active)layout();});new ResizeObserver(()=>{if(active)layout();}).observe(stage);
    window.addEventListener('message',event=>{if(event.origin!==ORIGIN||event.data?.type!==CHANNEL)return;const pane=panes.get(event.data.id);if(!pane||event.source!==pane.frame.contentWindow)return;if(event.data.activate){closeMenus();activate(pane.id);return;}if(event.data.dismiss){closeMenus();return;}if(event.data.error){pane.failed=true;pane.ready=false;pane.node.classList.remove('is-ready');pane.frame.inert=true;pane.frame.tabIndex=-1;pane.state.textContent='隔离未就绪，请重载';pane.state.title=pane.state.textContent;return;}if(typeof event.data.character!=='string'||pane.failed)return;pane.ready=true;pane.node.classList.add('is-ready');pane.frame.inert=false;pane.frame.tabIndex=0;pane.character=event.data.character;pane.node.dataset.character=pane.character;pane.node.setAttribute('aria-label',name(pane.character)+'的角色窗口');pane.caption.textContent=name(pane.character);pane.caption.title=name(pane.character);pane.scaleSelect.setAttribute('aria-label','内容缩放 '+name(pane.character));pane.minimize.setAttribute('aria-label','最小化 '+name(pane.character));pane.remove.setAttribute('aria-label','关闭 '+name(pane.character));pane.frame.title=name(pane.character)+'的官方界面';refresh();save();});
  });
})();
