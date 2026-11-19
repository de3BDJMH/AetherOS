// ==UserScript==
// @name         Aether 多角色同屏
// @namespace    mugen.aether.multiview
// @version      0.22.0
// @description  官网多角色桌面、背包筛选与置顶云同步、强化预测及手动启动的连续用券。
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
  const SCRIPT_VERSION='0.22.0';
  const ACTIVE='aether_active_character',CONFIG='aether-multiview-layout-v1',PREFIX='aether-multiview:',CHANNEL='aether-multiview-state',ORIGIN=location.origin;
  const ready=fn=>document.readyState==='loading'?document.addEventListener('DOMContentLoaded',fn,{once:true}):fn();
  const element=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  const button=(text,fn)=>{const node=element('button',text);node.type='button';node.addEventListener('click',fn);return node;};
  const GEAR_SLOTS={weapon:['\u6b66\u5668','mdi-sword'],top:['\u4e0a\u88c5','mdi-tshirt-crew'],bottom:['\u4e0b\u88c5','mdi-underwear-outline'],gloves:['\u624b\u90e8','mdi-boxing-glove'],shoes:['\u978b\u90e8','mdi-shoe-sneaker'],accessory:['\u9970\u54c1','mdi-necklace'],none:['\u672a\u6807\u6ce8','mdi-help-circle-outline']};
  const equipmentSlot=item=>Object.hasOwn(GEAR_SLOTS,item?.slot)&&item.slot!=='none'?item.slot:'none';
  function notifyPinChange(character,uuid,pinned){try{window.top.dispatchEvent(new window.top.CustomEvent('aether-pin-change',{detail:{character,uuid,pinned}}));}catch{}}
  function reinforceProgressFromStatus(character,data){
    if(!Array.isArray(data?.backpack?.equipment)||!Array.isArray(data?.equipment_slots))throw new Error('\u5b98\u7f51\u88c5\u5907\u6570\u636e\u7ed3\u6784\u65e0\u6548\uff0c\u672c\u89d2\u8272\u672a\u5bfc\u5165');
    const items=new Map();let skipped=0;
    const add=(item,slot)=>{if(!item||typeof item!=='object')return;if(typeof item.uuid!=='string'||!item.uuid||item.uuid.length>128){skipped++;return;}items.set(item.uuid,{...items.get(item.uuid),...item,...(slot?{slot}:{})});};
    data.backpack.equipment.forEach(item=>add(item));data.equipment_slots.forEach(row=>{if(row?.item)add(row.item,row.slot);});const records=[];
    for(const item of items.values()){
      const level=item.reinforce_level,fails=item.reinforce_fails;if(!Number.isInteger(level)||level<0||level>15||!Number.isSafeInteger(fails)||fails<0||fails>1000000){skipped++;continue;}if(level===0&&fails===0)continue;
      records.push({character,uuid:item.uuid,info:{equipment:{name:typeof item.name==='string'?item.name.slice(0,200):'',item_id:typeof item.item_id==='string'?item.item_id.slice(0,128):'',slot:typeof item.slot==='string'?item.slot.slice(0,30):'',rarity:Number.isInteger(item.rarity)&&item.rarity>=0&&item.rarity<=10?item.rarity:0,reinforce_level:level},maxed:level===15,next:level<15?{fails}:null}});
    }
    return {records,skipped};
  }
  function initEquipmentUsage(){
    const guard=Symbol.for('aether.equipment.usage');if(window[guard])return;
    const KEY='aether-equipment-usage-v1:',TTL=300000,states=new Map(),xhr=new WeakMap(),nativeFetch=window.fetch;
    let clock=0,queued=false,active='',index=new Map(),signature='',picked=null,popover=null;
    const role=()=>{try{return sessionStorage.getItem(ACTIVE)?.trim()||'';}catch{return '';}};
    const cellItems=new WeakMap();
    const own=node=>{node.dataset.amvUsageOwned='';return node;};
    const text=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
    const validId=value=>typeof value==='string'&&value.length>0&&value.length<=200;
    function state(who){
      if(!states.has(who)){
        let cached=null;try{const value=JSON.parse(localStorage.getItem(KEY+who)||'null');if(value?.version===1&&value.character===who&&Number.isSafeInteger(value.updatedAt)&&Array.isArray(value.presets)&&value.presets.length<=100&&value.presets.every(row=>validId(row.id)&&typeof row.name==='string'&&Array.isArray(row.uuids)&&row.uuids.length<=6&&row.uuids.every(validId)))cached=value;}catch{}
        states.set(who,{cached,pending:null,error:'',attempted:0});
      }return states.get(who);
    }
    function describe(input,options={}){
      try{const request=input instanceof Request?input:null,url=new URL(request?.url||String(input),ORIGIN),method=String(options.method||request?.method||'GET').toUpperCase();
        if(url.origin!==ORIGIN||!/^\/api\/aether\/status\/presets(?:\/(?:save|rename|delete|offline))?$/.test(url.pathname)||!['GET','POST'].includes(method))return null;
        const headers=new Headers(options.headers||request?.headers),who=url.searchParams.get('_aether_character')||headers.get('X-Aether-Character')||role();
        return who?{who,startedAt:clock=Math.max(Date.now(),clock+1)}:null;
      }catch{return null;}
    }
    function accept(request,payload){
      if(!request||payload?.code!==0||!Array.isArray(payload.data?.presets))return false;
      const presets=[];
      for(const row of payload.data.presets){
        if(row?.empty===true)continue;
        if(!Number.isInteger(row?.index)||row.index<0||row.index>99||typeof row.name!=='string'||!row.equipment||typeof row.equipment!=='object'||Array.isArray(row.equipment))return false;
        const uuids=[];for(const [slot,item]of Object.entries(row.equipment)){if(!Object.hasOwn(GEAR_SLOTS,slot)||slot==='none')return false;if(item!==null&&!validId(item?.uuid))return false;if(item)uuids.push(item.uuid);}
        presets.push({id:String(row.index),name:row.name.slice(0,100)||'\u9884\u8bbe '+(row.index+1),uuids:[...new Set(uuids)]});
      }
      const current=state(request.who);if((current.cached?.startedAt||0)>request.startedAt)return true;
      current.cached={version:1,character:request.who,startedAt:request.startedAt,updatedAt:Date.now(),presets};current.error='';
      try{localStorage.setItem(KEY+request.who,JSON.stringify(current.cached));}catch{current.error='\u9884\u8bbe\u5360\u7528\u7f13\u5b58\u672a\u80fd\u4fdd\u5b58\u5728\u672c\u673a';}
      signature='';close();schedule();return true;
    }
    // 只观察官方预设的返回，不改写请求、响应或游戏操作。
    window.fetch=function(input,options){const request=describe(input,options);const promise=Reflect.apply(nativeFetch,this,arguments);if(request)promise.then(response=>{if(response.ok)response.clone().json().then(data=>accept(request,data)).catch(()=>{});},()=>{});return promise;};
    const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send,setHeader=XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open=function(method,url,...args){xhr.set(this,{method,url,headers:{}});return Reflect.apply(open,this,[method,url,...args]);};
    XMLHttpRequest.prototype.setRequestHeader=function(name,value){const request=xhr.get(this);if(request&&String(name).toLowerCase()==='x-aether-character')request.headers[name]=value;return Reflect.apply(setHeader,this,arguments);};
    XMLHttpRequest.prototype.send=function(){const metadata=xhr.get(this),request=metadata&&describe(metadata.url,metadata);if(request)this.addEventListener('load',()=>{try{if(this.status>=200&&this.status<300)accept(request,typeof this.response==='string'?JSON.parse(this.response):this.response);}catch{}},{once:true});return Reflect.apply(send,this,arguments);};
    async function refresh(who,force=false){
      if(!who)return;const current=state(who);if(current.pending)return current.pending;
      if(!force&&(current.cached&&Date.now()-current.cached.updatedAt<TTL||Date.now()-current.attempted<30000))return;
      current.attempted=Date.now();current.error='';
      current.pending=(async()=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);try{
        const url=new URL('/api/aether/status/presets',ORIGIN);url.searchParams.set('_aether_character',who);const request=describe(url);
        const response=await Reflect.apply(nativeFetch,window,[url,{credentials:'same-origin',cache:'no-store',headers:{'X-Aether-Character':who},signal:controller.signal}]);
        const data=await response.json();if(!response.ok||!accept(request,data))throw Error('\u5b98\u65b9\u9884\u8bbe\u8bfb\u53d6\u5931\u8d25\uff0c\u6807\u8bb0\u53ef\u80fd\u4e0d\u5b8c\u6574');
      }catch{current.error='\u5b98\u65b9\u9884\u8bbe\u8bfb\u53d6\u5931\u8d25\uff0c\u6807\u8bb0\u53ef\u80fd\u4e0d\u5b8c\u6574';}finally{clearTimeout(timer);current.pending=null;schedule();}})();schedule();return current.pending;
    }
    function rebuild(who){
      let raw='',custom=[],error='';try{raw=localStorage.getItem(CLOUD_LOADOUTS+who)??localStorage.getItem(LEGACY_LOADOUTS+who)??'';custom=orderedLoadouts(loadoutDocument(who));}catch{error='\u81ea\u5efa\u9884\u8bbe\u8bfb\u53d6\u5931\u8d25\uff0c\u6807\u8bb0\u53ef\u80fd\u4e0d\u5b8c\u6574';}
      const current=state(who),next=JSON.stringify([who,current.cached,raw,error]);if(next===signature)return error;
      signature=next;index=new Map();
      const add=(uuid,source,id,name)=>{if(!validId(uuid))return;const rows=index.get(uuid)||[];if(!rows.some(row=>row.source===source&&row.id===id))rows.push({source,id,name});index.set(uuid,rows);};
      for(const row of current.cached?.presets||[])for(const uuid of row.uuids)add(uuid,'\u5b98\u65b9',row.id,row.name);
      for(const row of custom)if(!row.preset.empty)for(const item of Object.values(row.preset.equipment||{}))if(item)add(item.uuid,'\u81ea\u5efa',row.id,row.preset.name);
      return error;
    }
    const refs=uuid=>index.get(uuid)||[];
    const labels=rows=>rows.map(row=>row.source+' \u00b7 '+row.name).join('\uff1b');
    function close(){popover?.remove();popover=null;}
    function show(anchor,uuid){
      close();const rows=refs(uuid);if(!rows.length)return;popover=own(element('section',undefined,'amv-usage-popover'));popover.setAttribute('role','dialog');popover.setAttribute('aria-label','\u88c5\u5907\u5360\u7528\u9884\u8bbe');
      const head=element('header'),dismiss=button('\u00d7',event=>{event.stopPropagation();close();anchor.focus();});dismiss.setAttribute('aria-label','\u5173\u95ed\u5360\u7528\u8be6\u60c5');head.append(element('strong','\u5360\u7528\u6b64\u88c5\u5907\u7684\u9884\u8bbe'),dismiss);popover.append(head);
      for(const row of rows){const line=element('div');line.append(element('small',row.source),element('span',row.name));popover.append(line);}document.body.append(popover);
      const rect=anchor.getBoundingClientRect(),box=popover.getBoundingClientRect();popover.style.left=Math.max(10,Math.min(rect.left,innerWidth-box.width-10))+'px';popover.style.top=Math.max(10,Math.min(rect.bottom+8,innerHeight-box.height-10))+'px';
    }
    function badge(cell,item){
      cellItems.set(cell,item);const rows=refs(item.uuid);let mark=cell.querySelector(':scope > [data-amv-usage-badge]');if(!rows.length){mark?.remove();return;}
      if(!mark){mark=own(button('',event=>{event.preventDefault();event.stopImmediatePropagation();show(mark,mark.dataset.uuid);}));mark.className='amv-usage-badge';mark.dataset.amvUsageBadge='';for(const type of ['pointerdown','mousedown','touchstart','touchend','dblclick','contextmenu'])mark.addEventListener(type,event=>event.stopPropagation());cell.append(mark);}
      mark.dataset.uuid=item.uuid;text(mark,'\u25a4 '+rows.length);mark.title=labels(rows);mark.setAttribute('aria-label',(item.name||'\u88c5\u5907')+'\uff1a\u5360\u7528 '+rows.length+' \u5957\u9884\u8bbe\uff0c\u70b9\u51fb\u67e5\u770b');
    }
    function info(host,item){
      const rows=refs(item.uuid);let box=host.querySelector(':scope > [data-amv-usage-info]');if(!rows.length){box?.remove();return;}
      if(!box){box=own(element('section',undefined,'amv-usage-info'));box.dataset.amvUsageInfo='';host.append(box);}text(box,'\u5360\u7528 '+rows.length+' \u5957\u9884\u8bbe\uff1a'+labels(rows));
    }
    function status(panel,who,error){
      let bar=panel.querySelector(':scope > [data-amv-usage-status]');if(!bar){bar=own(element('div',undefined,'amv-usage-status'));bar.dataset.amvUsageStatus='';const copy=element('span'),reload=button('\u5237\u65b0\u9884\u8bbe',()=>refresh(role(),true));bar.append(copy,reload);const title=panel.querySelector(':scope > .bag-tabs,:scope > .section-title');title?title.after(bar):panel.prepend(bar);}
      const current=state(who);text(bar.firstElementChild,error||current.error||(current.pending?'\u6b63\u5728\u8bfb\u53d6\u5b98\u65b9\u9884\u8bbe\u5360\u7528\u2026':current.cached?'\u9884\u8bbe\u5360\u7528\uff1a\u5b98\u65b9\u4e0e\u81ea\u5efa\u8bb0\u5f55':'\u5b98\u65b9\u9884\u8bbe\u5c1a\u672a\u8bfb\u53d6'));bar.lastElementChild.disabled=!!current.pending;
    }
    function warning(host,selected){
      const used=[...selected].filter(uuid=>refs(uuid).length);let box=host.querySelector(':scope > [data-amv-usage-warning]');if(!used.length){box?.remove();return;}
      if(!box){box=own(element('p',undefined,'amv-usage-warning'));box.dataset.amvUsageWarning='';host.append(box);}text(box,'\u5df2\u9009 '+used.length+' \u4ef6\u88c5\u5907\u88ab\u9884\u8bbe\u4f7f\u7528\uff1a'+[...new Set(used.flatMap(uuid=>refs(uuid).map(row=>row.source+' \u00b7 '+row.name)))].join('\uff1b'));
    }
    const style=element('style');style.id='aether-equipment-usage-style';style.textContent=`
      .amv-usage-badge{position:absolute;top:-7px;left:50%;transform:translateX(-50%);z-index:9;min-width:23px;height:16px;padding:0 4px!important;margin:0!important;border:1px solid #b6a174!important;border-radius:4px!important;background:#263043!important;color:#ffe0a2!important;font:600 10px/14px system-ui!important;cursor:pointer;white-space:nowrap}.amv-usage-badge:focus-visible{outline:2px solid #9de9df;outline-offset:2px}.amv-usage-status{display:flex;align-items:center;gap:10px;justify-content:space-between;margin:8px 0;color:#aabbd2;font-size:11px}.amv-usage-status button{padding:3px 7px;border:1px solid #64799166;border-radius:5px;background:#1a2a3c;color:#cbdaf0;font:inherit;cursor:pointer}.amv-usage-info,.amv-usage-warning{border-top:1px solid #7790b044;padding-top:8px;margin:8px 0 0;color:#f3d39b;font-size:12px;line-height:1.65;white-space:normal;overflow-wrap:anywhere}.amv-usage-popover{position:fixed;z-index:2147483646;width:min(310px,calc(100vw - 20px));max-height:calc(100vh - 20px);overflow:auto;padding:12px;border:1px solid #71839d;border-radius:10px;background:#101c30;color:#e6edf9;box-shadow:0 8px 28px #02061799;font:13px/1.6 system-ui;box-sizing:border-box}.amv-usage-popover header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}.amv-usage-popover button{border:0;background:none;color:#c9d7ec;font:20px system-ui;cursor:pointer}.amv-usage-popover>div{display:flex;align-items:start;gap:8px;padding-top:5px;overflow-wrap:anywhere}.amv-usage-popover small{flex:none;font-size:10px;padding:1px 5px;border:1px solid #7285a644;border-radius:4px;color:#b2d5eb}
    `;document.head.append(style);
    function scan(){
      queued=false;const who=role();if(who!==active){active=who;picked=null;close();signature='';}if(!who)return;
      const error=rebuild(who),app=document.getElementById('app')?.__vue_app__,seen=new Set(),panels=new Set(),decomposeSelected=new Set(),sellSelected=new Set(),confirmations=new Set(),sheets=new Set();let found=false;
      function visit(node,inventory,item,mode){
        if(!node||typeof node!=='object'||seen.has(node))return;seen.add(node);if(Array.isArray(node)){for(const child of node)visit(child,inventory,item,mode);return;}
        const component=node.component,name=component?.type?.__name||component?.type?.name,props=component?.props;
        if(name==='BackpackPanel'){inventory=new Map((props.backpackEquipment||[]).filter(value=>validId(value?.uuid)).map(value=>[value.uuid,value]));const root=component.subTree?.el;if(root?.nodeType===1)panels.add(root);mode='bag';}
        if(name==='DecomposerPanel'){mode='decompose';const root=component.subTree?.el;if(root?.nodeType===1)panels.add(root);}
        if(inventory?.has(node.key))item=inventory.get(node.key);if(validId(props?.item?.uuid))item=props.item;
        if(mode==='decompose'&&props?.selected&&item)decomposeSelected.add(item.uuid);
        const el=node.el;if(el?.nodeType===1&&!el.hasAttribute('data-amv-usage-owned')){
          if(item&&el.matches('.bag-grid-item,.item-chip')){el.dataset.amvUsageUuid=item.uuid;badge(el,item);found=true;if(el.matches('.bag-grid-item--selected'))sellSelected.add(item.uuid);}
          if(item&&el.matches('.item-chip-tooltip'))info(el,item);
          if(item&&el.matches('.equip-tooltip-surface')){const host=el.querySelector('.equip-tooltip');if(host)info(host,item);}
          if(mode==='bag'&&el.matches('.item-sheet__info'))sheets.add(el);
          if(mode==='decompose'&&el.matches('.confirm-card'))confirmations.add(el.querySelector('.v-card-text')||el);
          if(item&&el.parentElement?.matches('.sell-list'))sellSelected.add(item.uuid);
        }
        if(component)visit(component.subTree,inventory,item,mode);else if(node.suspense)visit(node.suspense.activeBranch,inventory,item,mode);else if(Array.isArray(node.children))visit(node.children,inventory,item,mode);
      }
      visit(app?._container?._vnode||app?._instance?.subTree||app?._vnode,null,null,'');
      if(picked?.who===who)for(const sheet of sheets){const title=sheet.closest('.item-sheet')?.querySelector('.item-sheet__title')?.textContent||'';if(title.includes(picked.item.name))info(sheet,picked.item);}
      for(const panel of panels){if(panel.getClientRects().length){status(panel,who,error);refresh(who);}if(panel.querySelector('.decompose-footer'))warning(panel.querySelector('.decompose-footer'),decomposeSelected);}
      for(const host of confirmations)warning(host,decomposeSelected);
      for(const list of document.querySelectorAll('.sell-list'))warning(list.parentElement,sellSelected);
      if(popover&&!found)close();
    }
    function schedule(){if(!queued){queued=true;requestAnimationFrame(scan);}}
    new MutationObserver(records=>{if(records.some(record=>!record.target.closest?.('[data-amv-usage-owned]')&&(record.type==='attributes'||![...record.addedNodes,...record.removedNodes].every(node=>node.nodeType===1&&node.hasAttribute('data-amv-usage-owned')))))schedule();}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    document.addEventListener('click',event=>{const cell=event.target.closest?.('[data-amv-usage-uuid]');if(cell&&!event.target.closest('[data-amv-usage-owned]')){const uuid=cell.dataset.amvUsageUuid;picked={who:role(),item:cellItems.get(cell)||{uuid,name:cell.textContent}};}if(event.target.closest?.('.bag-card,.feature-panel'))schedule();},true);
    document.addEventListener('pointerdown',event=>{if(popover&&!event.target.closest('[data-amv-usage-owned]'))close();},true);document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});window.addEventListener('resize',close);
    window.addEventListener('storage',event=>{if(event.key===null||event.key===KEY+role()||event.key===CLOUD_LOADOUTS+role()||event.key===LEGACY_LOADOUTS+role()){if(event.key===null||event.key===KEY+role())states.delete(role());signature='';close();schedule();}});
    window.addEventListener('aether-loadout-change',()=>{signature='';close();schedule();});document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
    window[guard]={refresh:()=>refresh(role(),true)};schedule();
  }

  function initSpectrumLevelTooltips(){
    const guard=Symbol.for('aether.spectrum.level.tooltips');if(window[guard])return;window[guard]=true;
    const catalog={"prism_core_fire":{"name":"\u5149\u8c31\u00b7\u706b\u4e4b\u6cd5\u5219","max_level":4,"fields":[{"key":"per_affinity.factors.amplify_fire","label":"\u6bcf\u70b9\u4eb2\u548c\uff1a\u706b\u5143\u7d20\u5f3a\u5316","unit":"%","base":0.5,"increment":0.05},{"key":"per_affinity.factors.crit_rate","label":"\u6bcf\u70b9\u4eb2\u548c\uff1a\u66b4\u51fb\u7387","unit":"%","base":0.5,"increment":0.05}]},"prism_core_water":{"name":"\u5149\u8c31\u00b7\u6c34\u4e4b\u6cd5\u5219","max_level":4,"fields":[{"key":"per_affinity.factors.amplify_water","label":"\u6bcf\u70b9\u4eb2\u548c\uff1a\u6c34\u5143\u7d20\u5f3a\u5316","unit":"%","base":0.5,"increment":0.05},{"key":"per_affinity.factors.hp_pct","label":"\u6bcf\u70b9\u4eb2\u548c\uff1a\u6700\u5927\u751f\u547d","unit":"%","base":0.5,"increment":0.05}]},"prism_core_earth":{"name":"\u5149\u8c31\u00b7\u5730\u4e4b\u6cd5\u5219","max_level":4,"fields":[{"key":"per_affinity.factors.amplify_earth","label":"\u6bcf\u70b9\u4eb2\u548c\uff1a\u5730\u5143\u7d20\u5f3a\u5316","unit":"%","base":0.5,"increment":0.05},{"key":"per_affinity.factors.armor","label":"\u6bcf\u70b9\u4eb2\u548c\uff1a\u62a4\u7532","unit":"","base":10,"increment":0.5}]},"prism_core_wind":{"name":"\u5149\u8c31\u00b7\u98ce\u4e4b\u6cd5\u5219","max_level":4,"fields":[{"key":"per_affinity.factors.amplify_wind","label":"\u6bcf\u70b9\u4eb2\u548c\uff1a\u98ce\u5143\u7d20\u5f3a\u5316","unit":"%","base":0.5,"increment":0.05},{"key":"per_affinity.factors.spe","label":"\u6bcf\u70b9\u4eb2\u548c\uff1a\u901f\u5ea6","unit":"","base":0.5,"increment":0.05}]},"prism_core_lightning":{"name":"\u5149\u8c31\u00b7\u7535\u4e4b\u6cd5\u5219","max_level":4,"fields":[{"key":"per_affinity.factors.amplify_lightning","label":"\u6bcf\u70b9\u4eb2\u548c\uff1a\u96f7\u5143\u7d20\u5f3a\u5316","unit":"%","base":0.5,"increment":0.05},{"key":"per_affinity.factors.ap_gain_rate","label":"\u6bcf\u70b9\u4eb2\u548c\uff1aAP \u83b7\u53d6\u7387","unit":"%","base":0.5,"increment":0.05}]},"prism_core_light":{"name":"\u5149\u8c31\u00b7\u5149\u4e4b\u6cd5\u5219","max_level":4,"fields":[{"key":"per_affinity.factors.amplify_light","label":"\u6bcf\u70b9\u4eb2\u548c\uff1a\u5149\u5143\u7d20\u5f3a\u5316","unit":"%","base":0.5,"increment":0.05},{"key":"per_affinity.factors.luck","label":"\u6bcf\u70b9\u4eb2\u548c\uff1a\u5e78\u8fd0","unit":"","base":1,"increment":0.1}]},"prism_core_dark":{"name":"\u5149\u8c31\u00b7\u6697\u4e4b\u6cd5\u5219","max_level":4,"fields":[{"key":"per_affinity.factors.amplify_dark","label":"\u6bcf\u70b9\u4eb2\u548c\uff1a\u6697\u5143\u7d20\u5f3a\u5316","unit":"%","base":0.5,"increment":0.05},{"key":"per_affinity.factors.crit_dmg","label":"\u6bcf\u70b9\u4eb2\u548c\uff1a\u66b4\u51fb\u4f24\u5bb3","unit":"%","base":1,"increment":0.1}]},"prism_red_atk":{"name":"\u5149\u8c31\u00b7\u52c7\u731b","max_level":4,"fields":[{"key":"atk_pct","label":"\u653b\u51fb\u529b","unit":"%","base":10,"increment":1}]},"prism_red_crit":{"name":"\u5149\u8c31\u00b7\u7cbe\u51c6","max_level":4,"fields":[{"key":"stat_add.crit_rate","label":"\u66b4\u51fb\u7387","unit":"%","base":10,"increment":1}]},"prism_red_critdmg":{"name":"\u5149\u8c31\u00b7\u950b\u9510","max_level":4,"fields":[{"key":"stat_add.crit_dmg","label":"\u66b4\u51fb\u4f24\u5bb3","unit":"%","base":20,"increment":2}]},"prism_red_amp_fire":{"name":"\u5149\u8c31\u00b7\u706b\u5143\u7d20\u7cbe\u901a","max_level":4,"fields":[{"key":"stat_add.amplify_fire","label":"\u706b\u5143\u7d20\u5f3a\u5316","unit":"%","base":10,"increment":1}]},"prism_red_amp_water":{"name":"\u5149\u8c31\u00b7\u6c34\u5143\u7d20\u7cbe\u901a","max_level":4,"fields":[{"key":"stat_add.amplify_water","label":"\u6c34\u5143\u7d20\u5f3a\u5316","unit":"%","base":10,"increment":1}]},"prism_red_amp_lightning":{"name":"\u5149\u8c31\u00b7\u96f7\u5143\u7d20\u7cbe\u901a","max_level":4,"fields":[{"key":"stat_add.amplify_lightning","label":"\u96f7\u5143\u7d20\u5f3a\u5316","unit":"%","base":10,"increment":1}]},"prism_red_amp_earth":{"name":"\u5149\u8c31\u00b7\u5730\u5143\u7d20\u7cbe\u901a","max_level":4,"fields":[{"key":"stat_add.amplify_earth","label":"\u5730\u5143\u7d20\u5f3a\u5316","unit":"%","base":10,"increment":1}]},"prism_red_amp_wind":{"name":"\u5149\u8c31\u00b7\u98ce\u5143\u7d20\u7cbe\u901a","max_level":4,"fields":[{"key":"stat_add.amplify_wind","label":"\u98ce\u5143\u7d20\u5f3a\u5316","unit":"%","base":10,"increment":1}]},"prism_red_amp_light":{"name":"\u5149\u8c31\u00b7\u5149\u5143\u7d20\u7cbe\u901a","max_level":4,"fields":[{"key":"stat_add.amplify_light","label":"\u5149\u5143\u7d20\u5f3a\u5316","unit":"%","base":10,"increment":1}]},"prism_red_amp_dark":{"name":"\u5149\u8c31\u00b7\u6697\u5143\u7d20\u7cbe\u901a","max_level":4,"fields":[{"key":"stat_add.amplify_dark","label":"\u6697\u5143\u7d20\u5f3a\u5316","unit":"%","base":10,"increment":1}]},"prism_blue_hp":{"name":"\u5149\u8c31\u00b7\u4e30\u76c8","max_level":4,"fields":[{"key":"hp_pct","label":"\u6700\u5927\u751f\u547d","unit":"%","base":10,"increment":1}]},"prism_blue_dr":{"name":"\u5149\u8c31\u00b7\u575a\u97e7","max_level":4,"fields":[{"key":"armor_pct","label":"\u62a4\u7532","unit":"%","base":15,"increment":1}]},"prism_blue_heal":{"name":"\u5149\u8c31\u00b7\u6148\u7231","max_level":4,"fields":[{"key":"stat_add.heal_bonus","label":"\u6cbb\u7597\u52a0\u6210","unit":"%","base":10,"increment":1}]},"prism_green_spe":{"name":"\u5149\u8c31\u00b7\u8fc5\u6377","max_level":4,"fields":[{"key":"stat_add.spe","label":"\u901f\u5ea6","unit":"","base":10,"increment":1}]},"prism_green_ap":{"name":"\u5149\u8c31\u00b7\u6d41\u8f6c","max_level":4,"fields":[{"key":"stat_add.ap_gain_rate","label":"AP \u83b7\u53d6\u7387","unit":"%","base":10,"increment":1}]},"prism_red_fire_burn":{"name":"\u5149\u8c31\u00b7\u70c8\u7130\u89e6\u5a92","max_level":1,"fields":[],"description":"\u7ea2\u8272\u5149\u8c31\u3002\u666e\u901a\u653b\u51fb\u540e\uff0c\u5bf9\u76ee\u6807\u65bd\u52a0 2 \u5c42\u3010\u71c3\u70e7\u3011\u3002\u9700\u8981 20 \u70b9\u706b\u5143\u7d20\u4eb2\u548c\u529b\u65b9\u53ef\u88c5\u586b\u3002"},"prism_blue_water_overcap":{"name":"\u5149\u8c31\u00b7\u56de\u6f9c","max_level":4,"fields":[{"key":"combat.ratio","label":"\u5df2\u635f\u5931\u751f\u547d\u56de\u590d\u6bd4\u4f8b","unit":"%","base":4,"increment":0.5},{"key":"combat.interval","label":"\u89e6\u53d1\u95f4\u9694","unit":"","base":20,"increment":0}]},"prism_green_earth_ap":{"name":"\u5149\u8c31\u00b7\u5438\u6536","max_level":1,"fields":[],"description":"\u7eff\u8272\u5149\u8c31\u3002\u53d7\u5230\u4f24\u5bb3\u540e\uff0c\u6062\u590d 5 AP\uff0c\u4e0d\u53d7 AP \u6062\u590d\u7387\u5f71\u54cd\u3002\u9700\u8981 20 \u70b9\u5730\u5143\u7d20\u4eb2\u548c\u529b\u65b9\u53ef\u88c5\u586b\u3002"},"prism_green_wind_precharge":{"name":"\u5149\u8c31\u00b7\u5148\u53d1\u5236\u4eba","max_level":1,"fields":[],"description":"\u7eff\u8272\u5149\u8c31\u3002\u6218\u6597\u5f00\u59cb\u65f6\uff0c\u4ee5\u592a\u7206\u53d1\u4ee5\u5916\u7684\u6240\u6709\u6280\u80fd\u7acb\u5373\u5c31\u7eea\u3002\u9700\u8981 20 \u70b9\u98ce\u5143\u7d20\u4eb2\u548c\u529b\u65b9\u53ef\u88c5\u586b\u3002"},"prism_green_lightning_reset":{"name":"\u5149\u8c31\u00b7\u8fde\u7ef5\u4e0d\u7edd","max_level":1,"fields":[],"description":"\u7eff\u8272\u5149\u8c31\u3002\u91ca\u653e\u4ee5\u592a\u7206\u53d1\u540e\uff0c\u81ea\u8eab\u666e\u901a\u653b\u51fb\u7acb\u5373\u5c31\u7eea\u3002\u89e6\u53d1\u540e 30 \u884c\u52a8\u503c\u5185\u4e0d\u4f1a\u518d\u6b21\u89e6\u53d1\u3002\u9700\u8981 20 \u70b9\u96f7\u5143\u7d20\u4eb2\u548c\u529b\u65b9\u53ef\u88c5\u586b\u3002"},"prism_blue_light_cleanse":{"name":"\u5149\u8c31\u00b7\u81ea\u51c0","max_level":1,"fields":[],"description":"\u84dd\u8272\u5149\u8c31\u3002\u91ca\u653e\u4ee5\u592a\u7206\u53d1\u540e\uff0c\u79fb\u9664\u81ea\u8eab\u6240\u6709\u53ef\u9a71\u6563\u7684\u51cf\u76ca\u3002\u9700\u8981 20 \u70b9\u5149\u5143\u7d20\u4eb2\u548c\u529b\u65b9\u53ef\u88c5\u586b\u3002"},"prism_red_dark_crit":{"name":"\u5149\u8c31\u00b7\u5e55\u5203","max_level":1,"fields":[],"description":"\u7ea2\u8272\u5149\u8c31\u3002\u81ea\u8eab\u7684\u666e\u901a\u6280\u80fd\u53ef\u66b4\u51fb\u3002\u9700\u8981 20 \u70b9\u6697\u5143\u7d20\u4eb2\u548c\u529b\u65b9\u53ef\u88c5\u586b\u3002"},"prism_red_fire_burndmg":{"name":"\u5149\u8c31\u00b7\u70c8\u7130\u88c1\u51b3","max_level":4,"fields":[{"key":"combat.per_stack","label":"\u6bcf\u5c42\u707c\u70e7\u589e\u4f24","unit":"%","base":3,"increment":0.3}]},"prism_red_water_hpdmg":{"name":"\u5149\u8c31\u00b7\u6f6e\u6c50","max_level":4,"fields":[{"key":"combat.ratio","label":"\u9644\u52a0\u4f24\u5bb3\u5360\u6700\u5927\u751f\u547d","unit":"%","base":5,"increment":0.5}]},"prism_blue_earth_shield":{"name":"\u5149\u8c31\u00b7\u78d0\u77f3","max_level":4,"fields":[{"key":"combat.block","label":"\u6bcf\u6b21\u53d7\u51fb\u62b5\u6263","unit":"","base":100,"increment":20}]},"prism_green_wind_extend":{"name":"\u5149\u8c31\u00b7\u5ef6\u7ef5","max_level":4,"fields":[{"key":"combat.extend","label":"\u98ce\u6301\u7eed\u4f24\u5bb3\u5ef6\u957f","unit":"%","base":10,"increment":5}]},"prism_green_lightning_spestack":{"name":"\u5149\u8c31\u00b7\u6b65\u6b65\u751f\u96f7","max_level":4,"fields":[{"key":"combat.per_stack","label":"\u6bcf\u5c42\u901f\u5ea6\u63d0\u5347","unit":"%","base":5,"increment":0.5}]},"prism_red_light_conv":{"name":"\u5149\u8c31\u00b7\u540c\u8c03","max_level":4,"fields":[{"key":"combat.ratio","label":"\u6bcf\u70b9\u5e78\u8fd0\uff1a\u4f24\u5bb3\u63d0\u5347","unit":"%","base":0.25,"increment":0.025}]},"prism_green_dark_kill":{"name":"\u5149\u8c31\u00b7\u541e\u566c","max_level":4,"fields":[{"key":"combat.ap","label":"\u51fb\u6740\u56de\u590d AP","unit":"","base":50,"increment":5},{"key":"combat.hp_ratio","label":"\u51fb\u6740\u56de\u590d\u751f\u547d","unit":"%","base":50,"increment":5}]},"prism_red_azure_wave_plus":{"name":"\u5149\u8c31\u00b7\u78a7\u6ce2\u00b7\u5f3a\u5316","max_level":1,"fields":[],"description":"\u7ea2\u8272\u5149\u8c31\u3002\u88c5\u586b\u540e\uff0c\u81ea\u8eab\u7684\u3010\u78a7\u6ce2\u3011\u5f3a\u5316\u4e3a\u3010\u78a7\u6ce2+\u3011\uff1a\u5bf9\u654c\u65b9\u5168\u4f53\u9020\u6210\u65bd\u672f\u8005\u6700\u5927\u751f\u547d\u503c 10% + 0.75 \u500d\u653b\u51fb\u529b\u7684\u6c34\u5c5e\u6027\u4f24\u5bb3\uff0c\u968f\u540e\u4f7f\u5176\u6c34\u5c5e\u6027\u6297\u6027\u964d\u4f4e 20%\uff0c\u6301\u7eed 100 \u884c\u52a8\u503c\uff08\u91cd\u590d\u65bd\u52a0\u65f6\u5237\u65b0\u6301\u7eed\u65f6\u95f4\uff09\uff1b\u53ea\u547d\u4e2d 1 \u540d\u654c\u4eba\u65f6\uff0c\u4f24\u5bb3\u4e0e\u6297\u6027\u964d\u4f4e\u5e45\u5ea6\u5747\u63d0\u9ad8 50%\u3002\u4e4b\u540e\u4f7f\u751f\u547d\u503c\u6bd4\u4f8b\u6700\u4f4e\u7684\u53cb\u65b9\uff08\u4f18\u5148\u672a\u6ee1\u751f\u547d\u503c\u8005\uff09\u56de\u590d\u7b49\u540c\u4e8e\u9020\u6210\u603b\u4f24\u5bb3\u7684\u751f\u547d\u503c\u3002\u9700\u8981 30 \u70b9\u6c34\u5143\u7d20\u4eb2\u548c\u529b\u65b9\u53ef\u88c5\u586b\u3002"},"prism_blue_iron_defense_plus":{"name":"\u5149\u8c31\u00b7\u94c1\u58c1\u00b7\u5f3a\u5316","max_level":1,"fields":[],"description":"\u84dd\u8272\u5149\u8c31\u3002\u88c5\u586b\u540e\uff0c\u81ea\u8eab\u7684\u3010\u94c1\u58c1\u3011\u5f3a\u5316\u4e3a\u3010\u94c1\u58c1+\u3011\uff1a\u81ea\u8eab\u51cf\u4f24\u7387\u63d0\u5347 30%\uff0c\u6301\u7eed 5 \u56de\u5408\uff1b\u5e76\u6bcf\u56de\u5408\u56de\u590d\u81ea\u8eab 8% \u6700\u5927\u751f\u547d\u503c\uff0c\u6301\u7eed 3 \u56de\u5408\uff08\u65bd\u653e\u65f6\u7acb\u5373\u56de\u590d\u4e00\u6b21\uff0c\u5171 4 \u6b21\uff09\u3002\u9700\u8981 30 \u70b9\u5730\u5143\u7d20\u4eb2\u548c\u529b\u65b9\u53ef\u88c5\u586b\u3002"},"prism_blue_holy_light_plus":{"name":"\u5149\u8c31\u00b7\u5723\u5149\u00b7\u5f3a\u5316","max_level":1,"fields":[],"description":"\u84dd\u8272\u5149\u8c31\u3002\u88c5\u586b\u540e\uff0c\u81ea\u8eab\u7684\u3010\u5723\u5149\u3011\u5f3a\u5316\u4e3a\u3010\u5723\u5149+\u3011\uff1a\u4f7f\u672a\u6ee1\u751f\u547d\u503c\u7684\u53cb\u65b9\u4e2d\u751f\u547d\u503c\u6bd4\u4f8b\u6700\u4f4e\u8005\uff08\u5168\u5458\u6ee1\u751f\u547d\u503c\u65f6\u4e3a\u751f\u547d\u503c\u6bd4\u4f8b\u6700\u4f4e\u8005\uff09\u56de\u590d\u7b49\u540c\u4e8e\u65bd\u672f\u8005 20% \u6700\u5927\u751f\u547d\u503c + 100% \u653b\u51fb\u529b\u7684\u751f\u547d\u503c\uff1b\u968f\u540e\u4f7f\u5176\u4ed6\u53cb\u65b9\u83b7\u5f97\u7b49\u540c\u4e8e\u65bd\u672f\u8005\u57fa\u7840\u653b\u51fb\u529b (20 + \u5e78\u8fd0 \u00d7 0.2)% \u7684\u56fa\u5b9a\u653b\u51fb\u529b\u52a0\u6210\uff0c\u6301\u7eed 100 \u884c\u52a8\u503c\uff08\u91cd\u590d\u65bd\u52a0\u65f6\u5237\u65b0\u6301\u7eed\u65f6\u95f4\uff09\u3002\u9700\u8981 30 \u70b9\u5149\u5143\u7d20\u4eb2\u548c\u529b\u65b9\u53ef\u88c5\u586b\u3002"},"prism_red_shadow_sneak_plus":{"name":"\u5149\u8c31\u00b7\u5f71\u5b50\u5077\u88ad\u00b7\u5f3a\u5316","max_level":1,"fields":[],"description":"\u7ea2\u8272\u5149\u8c31\u3002\u88c5\u586b\u540e\uff0c\u81ea\u8eab\u7684\u3010\u5f71\u5b50\u5077\u88ad\u3011\u5f3a\u5316\u4e3a\u3010\u5f71\u5b50\u5077\u88ad+\u3011\uff1a\u6d88\u8017\u81ea\u8eab\u5f53\u524d\u751f\u547d\u503c\u7684 (30 - 0.5 \u00d7 \u6697\u5143\u7d20\u4eb2\u548c)%\uff0c\u5bf9\u5f53\u524d\u751f\u547d\u503c\u6700\u4f4e\u7684\u654c\u4eba\u9020\u6210 2.0 \u500d\u653b\u51fb\u529b\u7684\u6697\u5c5e\u6027\u4f24\u5bb3\uff0c\u5e76\u4f7f\u5176\u51cf\u4f24\u7387\u964d\u4f4e 10%\uff0c\u6301\u7eed 100 \u884c\u52a8\u503c\uff08\u91cd\u590d\u65bd\u52a0\u65f6\u5237\u65b0\u6301\u7eed\u65f6\u95f4\uff09\u3002\u9700\u8981 30 \u70b9\u6697\u5143\u7d20\u4eb2\u548c\u529b\u65b9\u53ef\u88c5\u586b\u3002"},"prism_blue_frost_resist":{"name":"\u5149\u8c31\u00b7\u51dd\u971c","max_level":4,"fields":[{"key":"stat_add.debuff_resist","label":"\u5f31\u5316\u8010\u6027","unit":"%","base":10,"increment":1}]},"prism_blue_frost_lowhp":{"name":"\u5149\u8c31\u00b7\u96ea\u969c","max_level":4,"fields":[{"key":"combat.dr","label":"\u4f4e\u8840\u91cf\u989d\u5916\u51cf\u4f24","unit":"%","base":12,"increment":1}]},"prism_red_frost_debuffed":{"name":"\u5149\u8c31\u00b7\u51b0\u9525","max_level":4,"fields":[{"key":"combat.ratio","label":"\u5f31\u5316\u654c\u4eba\u589e\u4f24","unit":"%","base":8,"increment":0.8}]},"prism_green_frost_ap":{"name":"\u5149\u8c31\u00b7\u51db\u51bd","max_level":4,"fields":[{"key":"combat.ap","label":"\u6bcf\u6b21\u9644\u52a0\u5f31\u5316\u56de\u590d AP","unit":"","base":6,"increment":1}]},"prism_core_resonance":{"name":"\u7eaf\u51c0\u5149\u8c31\u00b7\u5168\u80fd\u5171\u9e23","max_level":4,"fields":[{"key":"all_affinity_attack","label":"\u6bcf\u70b9\u5168\u5143\u7d20\u4eb2\u548c\uff1a\u653b\u51fb\u529b","unit":"","base":5,"increment":0.5}]},"prism_core_purity":{"name":"\u7eaf\u51c0\u5149\u8c31\u00b7\u6052\u51c0\u4e4b\u8eaf","max_level":4,"fields":[{"key":"stat_add.debuff_resist","label":"\u5f31\u5316\u8010\u6027","unit":"%","base":40,"increment":4}]},"prism_core_attunement":{"name":"\u7eaf\u51c0\u5149\u8c31\u00b7\u5143\u7d20\u5951\u5408","max_level":4,"fields":[{"key":"all_affinity_add","label":"\u6bcf\u79cd\u5143\u7d20\u4eb2\u548c\u589e\u52a0","unit":"","base":2,"increment":1}]},"prism_core_endless_fire":{"name":"\u7eaf\u51c0\u5149\u8c31\u00b7\u65e0\u5c3d\u4e4b\u706b","max_level":4,"fields":[{"key":"combat.burn_stack_limit_bonus","label":"\u71c3\u70e7\u5c42\u6570\u4e0a\u9650\u589e\u52a0","unit":"","base":1,"increment":1}]},"prism_core_overflow":{"name":"\u7eaf\u51c0\u5149\u8c31\u00b7\u6ea2\u6d41","max_level":4,"fields":[{"key":"combat.cap","label":"\u751f\u547d\u5bb9\u7eb3\u4e0a\u9650","unit":"%","base":200,"increment":10}]},"prism_core_static":{"name":"\u7eaf\u51c0\u5149\u8c31\u00b7\u9759\u7535","max_level":4,"fields":[{"key":"combat.slow_per_stack","label":"\u6bcf\u5c42\u9759\u7535\uff1a\u901f\u5ea6\u964d\u4f4e","unit":"%","base":2,"increment":0.1},{"key":"combat.ap_per_stack","label":"\u6bcf\u5c42\u9759\u7535\u56de\u6536\uff1a\u6062\u590d AP","unit":"","base":5,"increment":0}]},"prism_core_unbalance":{"name":"\u7eaf\u51c0\u5149\u8c31\u00b7\u5f3a\u529b\u5931\u8861","max_level":4,"fields":[{"key":"combat.slow","label":"\u901f\u5ea6\u964d\u4f4e","unit":"%","base":20,"increment":0},{"key":"combat.dr_reduction_per_affinity","label":"\u6bcf\u70b9\u5730\u4eb2\u548c\uff1a\u51cf\u4f24\u7387\u964d\u4f4e\u7cfb\u6570","unit":"%","base":0.4,"increment":0.02}]},"prism_core_wind_veil":{"name":"\u7eaf\u51c0\u5149\u8c31\u00b7\u98ce\u4e4b\u9762\u7eb1","max_level":4,"fields":[{"key":"combat.evasion_base","label":"\u57fa\u7840\u56de\u907f\u7387","unit":"%","base":10,"increment":1},{"key":"combat.evasion_per_25_speed","label":"\u6bcf25\u70b9\u901f\u5ea6\uff1a\u56de\u907f\u7387\u589e\u52a0","unit":"%","base":1,"increment":0}]},"prism_core_lucky":{"name":"\u7eaf\u51c0\u5149\u8c31\u00b7\u8d85\u5e78\u8fd0","max_level":4,"fields":[{"key":"combat.replay_chance_per_luck","label":"\u6bcf\u70b9\u5e78\u8fd0\uff1a\u7206\u53d1\u91cd\u653e\u6982\u7387","unit":"%","base":0.1,"increment":0.01}]},"prism_core_venom":{"name":"\u7eaf\u51c0\u5149\u8c31\u00b7\u566c\u8eab\u4e4b\u6bd2","max_level":4,"fields":[{"key":"combat.damage_ratio","label":"\u5b9e\u9645\u4f24\u5bb3\u8f6c\u4e3a\u86c7\u6bd2\uff1a\u57fa\u7840\u6bd4\u4f8b","unit":"%","base":10,"increment":1},{"key":"combat.dark_affinity_ratio","label":"\u6bcf\u70b9\u6697\u4eb2\u548c\uff1a\u86c7\u6bd2\u6bd4\u4f8b\u589e\u52a0","unit":"%","base":0.1,"increment":0.01}]},"prism_red_fire_flow":{"name":"\u5149\u8c31\u00b7\u707c\u6d41","max_level":4,"fields":[{"key":"combat.ratio","label":"\u71c3\u70e7\u4f24\u5bb3\u63d0\u5347","unit":"%","base":12,"increment":2}]},"prism_blue_fire_heart":{"name":"\u5149\u8c31\u00b7\u70bd\u5fc3","max_level":4,"fields":[{"key":"combat.ratio","label":"\u53d7\u5230\u7684\u975e\u706b\u4f24\u5bb3\u964d\u4f4e","unit":"%","base":6,"increment":1}]},"prism_blue_water_tide":{"name":"\u5149\u8c31\u00b7\u84c4\u6f6e","max_level":4,"fields":[{"key":"combat.ratio","label":"\u8d85\u989d\u751f\u547d\u51cf\u4f24","unit":"%","base":8,"increment":1}]},"prism_green_lightning_flow":{"name":"\u5149\u8c31\u00b7\u7eed\u6d41","max_level":4,"fields":[{"key":"combat.ap","label":"\u6062\u590d AP","unit":"","base":3,"increment":1}]},"prism_red_lightning_conduct":{"name":"\u5149\u8c31\u00b7\u5bfc\u7535","max_level":4,"fields":[{"key":"combat.ratio","label":"\u4ee5\u592a\u7206\u53d1\u96f7\u5c5e\u6027\u4f24\u5bb3\u63d0\u5347","unit":"%","base":12,"increment":2}]},"prism_blue_earth_front":{"name":"\u5149\u8c31\u00b7\u627f\u950b","max_level":4,"fields":[{"key":"combat.ratio","label":"\u524d\u6392\u666e\u901a\u653b\u51fb\u51cf\u4f24","unit":"%","base":10,"increment":1}]},"prism_red_earth_break":{"name":"\u5149\u8c31\u00b7\u7834\u9635","max_level":4,"fields":[{"key":"combat.ratio","label":"\u4f24\u5bb3\u63d0\u5347","unit":"%","base":12,"increment":1}]},"prism_blue_wind_dodge":{"name":"\u5149\u8c31\u00b7\u907f\u950b","max_level":4,"fields":[{"key":"combat.ratio","label":"\u4e0b\u6b21\u53d7\u5230\u7684\u654c\u65b9\u4f24\u5bb3\u964d\u4f4e","unit":"%","base":12,"increment":1}]},"prism_green_wind_echo":{"name":"\u5149\u8c31\u00b7\u4f59\u97f3","max_level":4,"fields":[{"key":"combat.ratio","label":"\u5176\u4ed6\u961f\u53cb\u4e0b\u6b21\u666e\u653b\u4f24\u5bb3\u63d0\u5347","unit":"%","base":10,"increment":1}]},"prism_red_light_replay":{"name":"\u5149\u8c31\u00b7\u8fd4\u7167","max_level":4,"fields":[{"key":"combat.ratio","label":"\u91cd\u653e\u4f24\u5bb3\u4e0e\u751f\u547d\u56de\u590d\u63d0\u5347","unit":"%","base":40,"increment":4}]},"prism_red_dark_marrow":{"name":"\u5149\u8c31\u00b7\u8680\u9ad3","max_level":4,"fields":[{"key":"combat.ratio","label":"\u86c7\u6bd2\u89e6\u53d1\u540e\uff1a\u5269\u4f59\u5c42\u6570\u4fdd\u7559\u6bd4\u4f8b","unit":"%","base":55,"increment":1}]},"prism_blue_dark_pact":{"name":"\u5149\u8c31\u00b7\u9006\u5951","max_level":4,"fields":[{"key":"combat.ratio","label":"\u53d7\u5230\u7684\u654c\u65b9\u4f24\u5bb3\u964d\u4f4e","unit":"%","base":8,"increment":1}]},"prism_red_neutral_blade":{"name":"\u5149\u8c31\u00b7\u7d20\u5203","max_level":4,"fields":[{"key":"combat.ratio","label":"\u65e0\u5c5e\u6027\u76f4\u63a5\u4f24\u5bb3\u63d0\u5347","unit":"%","base":10,"increment":1}]},"prism_blue_neutral_shield":{"name":"\u5149\u8c31\u00b7\u521d\u5c4f","max_level":4,"fields":[{"key":"combat.ratio","label":"\u5f00\u573a\u62a4\u76fe\u6bd4\u4f8b","unit":"%","base":12,"increment":2}]},"prism_green_fire_momentum":{"name":"\u5149\u8c31\u00b7\u71c3\u52bf","max_level":4,"fields":[{"key":"combat.ratio","label":"\u901f\u5ea6\u63d0\u5347","unit":"%","base":10,"increment":1}]},"prism_green_water_source":{"name":"\u5149\u8c31\u00b7\u56de\u6e90","max_level":4,"fields":[{"key":"combat.ap","label":"\u6062\u590d AP","unit":"","base":3,"increment":1}]},"prism_green_earth_charge":{"name":"\u5149\u8c31\u00b7\u84c4\u52bf","max_level":4,"fields":[{"key":"combat.ratio","label":"\u901f\u5ea6\u63d0\u5347","unit":"%","base":12,"increment":2}]},"prism_green_neutral_ready":{"name":"\u5149\u8c31\u00b7\u6574\u5907","max_level":4,"fields":[{"key":"combat.ratio","label":"\u666e\u901a\u6280\u80fd\u521d\u59cb\u51b7\u5374\u7f29\u51cf","unit":"%","base":20,"increment":5}]},"prism_blue_light_radiance":{"name":"\u5149\u8c31\u00b7\u51c0\u8f89","max_level":4,"fields":[{"key":"combat.interval","label":"\u6bcf\u540d\u76ee\u6807\u89e6\u53d1\u95f4\u9694","unit":"","base":80,"increment":-5}]}};
    const supported='.prism-socket-tt,.item-chip-tooltip,.formula-tooltip-surface,.equip-tooltip-surface,.item-sheet';
    const normalize=value=>String(value||'').trim().replace(/^(?:\u7eaf\u51c0)?\u5149\u8c31[\u00b7\u30fb\s]*/,'');
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
      const match=nameNode.textContent.trim().match(/^(.*?)(?:\s*[\u00b7\u30fb]?\s*Lv\s*(\d+))?$/i),id=aliases.get(normalize(match?.[1]));
      if(!id)return null;
      if(tip.matches('.item-chip-tooltip')&&!/^(?:\u7eaf\u51c0)?\u5149\u8c31[\u00b7\u30fb\s]/.test(nameNode.textContent.trim()))return null;
      return {id,level:match?.[2]?Math.min(catalog[id].max_level,Number(match[2])):null};
    }
    function levelTable(value){
      const entry=catalog[value.id],section=make('section');section.className='amv-spectrum-levels';section.dataset.amvSpectrumLevels=value.id;
      const title=make('div','\u5404\u7ea7\u6548\u679c');title.className='amv-spectrum-levels__title';title.append(make('small',value.level?'\u5f53\u524d Lv'+value.level:'\u7b49\u7ea7\u53c2\u6570'));section.append(title);
      if(entry.max_level===1){if(entry.description)section.append(make('div',entry.description));const note=make('div','\u4ec5 Lv1\uff0c\u4e0d\u53ef\u5347\u7ea7');note.className='amv-spectrum-levels__note';section.append(note);return section;}
      const table=make('table'),head=make('thead'),header=make('tr'),body=make('tbody');table.setAttribute('aria-label',normalize(entry.name)+'\u5404\u7ea7\u6548\u679c');header.append(make('th','\u6548\u679c'));
      function cell(tag,text,level){const node=make(tag,text);if(level===value.level)node.dataset.current='';return node;}
      for(let level=1;level<=entry.max_level;level++){const node=cell('th','Lv'+level,level);node.scope='col';header.append(node);}head.append(header);
      for(const field of entry.fields){
        if(!Number.isFinite(field.base)||!Number.isFinite(field.increment))continue;
        const row=make('tr'),label=make('th',field.label);label.scope='row';row.append(label);
        for(let level=1;level<=entry.max_level;level++){const number=Number((field.base+field.increment*(level-1)).toFixed(6));row.append(cell('td',number+(field.unit||''),level));}body.append(row);
      }
      table.append(head,body);section.append(table);
      const note=make('div','\u5217\u51fa\u7b49\u7ea7\u53c2\u6570\uff1b\u4eb2\u548c\u4e0e\u9762\u677f\u52a0\u6210\u6309\u516c\u5f0f\u6362\u7b97\uff0c\u89e6\u53d1\u6761\u4ef6\u6cbf\u7528\u539f\u8bf4\u660e\u3002');note.className='amv-spectrum-levels__note';section.append(note);return section;
    }
    const states=new WeakMap();
    function sync(tip){
      const host=tip.matches('.item-sheet')?tip.querySelector('.item-sheet__info'):tip.matches('.equip-tooltip-surface')?tip.querySelector('.equip-tooltip'):tip;
      if(!host)return;
      const value=owner(tip)||byTitle(tip),previous=states.get(tip),signature=value?value.id+':'+value.level:'';
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
    new MutationObserver(records=>{for(const record of records){schedule(record.target.nodeType===1?record.target:record.target.parentElement);for(const node of record.addedNodes)schedule(node);}}).observe(document.body,{childList:true,characterData:true,attributes:true,attributeFilter:['class'],subtree:true});
    schedule(document.body);
  }

  function initReinforceBulkRead(){
    if(window.top!==window||window[Symbol.for('aether.history.bulk')])return;const card=document.querySelector('[data-amv-pin-dialog] .amv-pin-card');if(!card)return;window[Symbol.for('aether.history.bulk')]=true;
    const section=element('section',undefined,'amv-history-bulk'),title=element('strong','\u6279\u91cf\u8bfb\u53d6\u5f3a\u5316\u8fdb\u5ea6'),intro=element('p','\u6bcf\u4e2a\u89d2\u8272\u53ea\u8bfb\u53d6\u4e00\u6b21\u72b6\u6001\uff0c\u5bfc\u5165\u5df2\u5f3a\u5316\u88c5\u5907\u53ca\u5f53\u524d\u5931\u8d25\u6b21\u6570\u3002\u5df2\u6709\u5386\u53f2\u4fdd\u7559\uff0c\u4e0d\u4f1a\u6267\u884c\u5f3a\u5316\u3002'),actions=element('div',undefined,'amv-pin-actions'),current=button('\u8bfb\u53d6\u5f53\u524d\u89d2\u8272',()=>begin(false)),all=button('\u8bfb\u53d6\u5168\u90e8\u89d2\u8272',()=>begin(true)),stop=button('\u505c\u6b62\u8bfb\u53d6',()=>{if(run){run.stopped=true;stop.disabled=true;feedback.textContent='\u5df2\u8bf7\u6c42\u505c\u6b62\uff0c\u5f53\u524d\u8bfb\u53d6\u5b8c\u6210\u540e\u4e0d\u518d\u7ee7\u7eed';}}),feedback=element('p');let run=null,character='';
    section.dataset.amvHistoryBulk='';current.dataset.amvHistoryCurrent='';all.dataset.amvHistoryAll='';stop.dataset.amvHistoryStop='';feedback.dataset.amvHistoryFeedback='';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');stop.hidden=true;actions.append(current,all,stop);section.append(title,intro,actions,feedback);card.querySelector('p').after(section);section.style.cssText='margin:14px 0;padding-top:12px;border-top:1px solid #ffffff20';title.style.fontSize='13px';
    const readCharacter=()=>{try{return sessionStorage.getItem(ACTIVE)||localStorage.getItem(ACTIVE)||'';}catch{return '';}};
    window.addEventListener('aether-pins-settings',event=>{character=typeof event.detail?.character==='string'?event.detail.character:readCharacter();current.textContent='\u8bfb\u53d6\u5f53\u524d\u89d2\u8272'+(character?' \u00b7 '+character:'');});
    async function get(path,who,active){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);let response;try{const url=new URL('/api/aether'+path,ORIGIN);if(who)url.searchParams.set('_aether_character',who);response=await fetch(url,{method:'GET',credentials:'same-origin',cache:'no-store',headers:who?{'X-Aether-Character':who}:{},signal:controller.signal});if(!response.ok){const error=new Error(response.status===401?'\u5b98\u7f51\u767b\u5f55\u5df2\u5931\u6548\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55\u540e\u8bfb\u53d6':response.status===429?'\u5b98\u7f51\u8bf7\u6c42\u9650\u6d41\uff0c\u8bf7\u7a0d\u540e\u518d\u8bfb\u53d6':'\u5b98\u7f51\u8bfb\u53d6\u5931\u8d25\uff1aHTTP '+response.status);error.stop=response.status===401||response.status===429;throw error;}const value=await response.json();if(value?.code!==0){const error=new Error('\u5b98\u7f51\u672a\u8fd4\u56de\u6709\u6548\u72b6\u6001');error.stop=[401,429].includes(value?.code);throw error;}const time=Date.parse(response.headers.get('Date')||'');active.now=Number.isFinite(time)?time:Date.now();return value.data;}finally{clearTimeout(timeout);}}
    async function begin(everyone){if(run)return;const active={stopped:false,now:Date.now()},who=character||readCharacter();if(!everyone&&!who){feedback.textContent='\u8bf7\u5148\u5728\u5b98\u7f51\u9009\u62e9\u89d2\u8272\uff0c\u6216\u4f7f\u7528\u8bfb\u53d6\u5168\u90e8\u89d2\u8272';return;}run=active;current.disabled=all.disabled=true;stop.hidden=false;stop.disabled=false;let completed=0,total=0,count=0,skipped=0;const errors=[];
      try{const execute=async()=>{const journal=createReinforceHistory(localStorage,()=>active.now,()=>window.dispatchEvent(new Event('aether-history-change')));let roles;
        if(everyone){feedback.textContent='\u6b63\u5728\u8bfb\u53d6\u81ea\u6709\u89d2\u8272\u5217\u8868\u2026';const account=await get('/account',null,active);if(!Array.isArray(account?.characters))throw Error('\u5b98\u7f51\u89d2\u8272\u5217\u8868\u7ed3\u6784\u65e0\u6548');roles=[...new Set(account.characters.filter(row=>typeof row?.username==='string'&&row.username.trim()&&row.username.length<=100&&row.type!=='offline_friend').map(row=>row.username))];if(roles.length>100)throw Error('\u89d2\u8272\u6570\u91cf\u5f02\u5e38\uff0c\u5df2\u505c\u6b62\u8bfb\u53d6');}else roles=[who];total=roles.length;
        for(const role of roles){if(active.stopped)break;feedback.textContent='\u6b63\u5728\u8bfb\u53d6 '+role+' \u00b7 '+(completed+1)+' / '+total;try{const value=await get('/status',role,active),result=reinforceProgressFromStatus(role,value);skipped+=result.skipped;
            for(let i=0;i<result.records.length;i++){if(active.stopped)break;const row=result.records[i];journal.observe(row.character,row.uuid,row.info);if(journal.warning)throw Error(journal.warning);count++;if(i%50===49)await new Promise(resolve=>setTimeout(resolve,0));}
          }catch(error){errors.push(role+'\uff1a'+(error.name==='AbortError'?'\u8bfb\u53d6\u8d85\u65f6':error.message));if(error.stop)active.stopped=true;}completed++;if(!active.stopped&&completed<total)await new Promise(resolve=>setTimeout(resolve,300));}
      };if(navigator.locks?.request)await navigator.locks.request('aether-history-bulk-read',{ifAvailable:true},async lock=>{if(!lock)throw Error('\u5176\u4ed6\u6807\u7b7e\u9875\u6b63\u5728\u6279\u91cf\u8bfb\u53d6\uff0c\u8bf7\u7b49\u5f85\u5b8c\u6210');await execute();});else await execute();
      }catch(error){errors.push(error.name==='AbortError'?'\u8bfb\u53d6\u8d85\u65f6':error.message);}finally{run=null;current.disabled=all.disabled=false;stop.hidden=true;feedback.textContent=(active.stopped?'\u5df2\u505c\u6b62':'\u8bfb\u53d6\u7ed3\u675f')+' \u00b7 \u5df2\u5904\u7406 '+completed+' / '+total+' \u4e2a\u89d2\u8272\uff0c\u5bfc\u5165 '+count+' \u4ef6\u88c5\u5907'+(skipped?'\uff0c\u8df3\u8fc7 '+skipped+' \u6761\u4e0d\u5b8c\u6574\u6570\u636e':'')+(errors.length?'\u3002'+errors.join('\uff1b'):'\u3002\u5df2\u6709\u5386\u53f2\u4fdd\u7559\uff0c\u8fde\u63a5\u4e91\u540c\u6b65\u540e\u81ea\u52a8\u4e0a\u4f20\u3002');if(count)window.dispatchEvent(new Event('aether-history-sync-now'));}
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
      if(busy||paused&&!force)return;const current=config();if(!current){status('\u5f3a\u5316\u8bb0\u5f55\u4ec5\u5b58\u672c\u673a\uff0c\u8fde\u63a5\u7f6e\u9876\u4e91\u540c\u6b65\u540e\u81ea\u52a8\u540c\u6b65');return;}if(document.hidden&&!force){schedule(30000);return;}busy=true;
      try{const run=async()=>{
        const latest=config();if(!latest||latest.server!==current.server||latest.client_id!==current.client_id)return;const progress=state(latest),records=[];let waiting=false,bytes=0;
        for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith(PREFIX))continue;let row;try{const raw=localStorage.getItem(key);row=normalizeReinforceRecord(JSON.parse(raw),true);if(!row)continue;const normalized=JSON.stringify(row);if(normalized!==raw)localStorage.setItem(key,normalized);}catch{continue;}if(progress.sent[key]===await hash(row))continue;const size=new TextEncoder().encode(JSON.stringify(row)).length;if(size>650000)throw new Error('\u5355\u4ef6\u5f3a\u5316\u8bb0\u5f55\u8fc7\u5927\uff0c\u8bf7\u4fdd\u7559\u672c\u673a\u6570\u636e\u540e\u68c0\u67e5');if(records.length<50&&bytes+size<=650000){records.push(row);bytes+=size;}else waiting=true;}
        if(!records.length&&!force&&Date.now()-progress.checked<30000){schedule(30000);return;}status('\u6b63\u5728\u540c\u6b65\u5f3a\u5316\u8bb0\u5f55\u2026');const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);let response,data;
        try{response=await fetch(latest.server+'/api/aetheros/history/sync',{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',headers:{'Content-Type':'application/json','Authorization':'Bearer '+latest.token},body:JSON.stringify({client_id:latest.client_id,cursor:progress.cursor,records}),signal:controller.signal});data=await response.json().catch(()=>({}));}finally{clearTimeout(timeout);}
        if(!response.ok){if(response.status===409&&typeof data.detail==='string'&&data.detail.includes('\u8fdb\u5ea6\u5df2\u91cd\u7f6e')){progress.cursor=0;progress.sent={};localStorage.setItem(KEY,JSON.stringify(progress));}else if([401,403,409,413,422].includes(response.status))paused=true;throw new Error(response.status===404?'Web \u5c1a\u672a\u66f4\u65b0\uff0c\u5f3a\u5316\u8bb0\u5f55\u4fdd\u7559\u5728\u672c\u673a':typeof data.detail==='string'?data.detail:'\u5f3a\u5316\u8bb0\u5f55\u540c\u6b65\u6682\u4e0d\u53ef\u7528\uff0c\u672c\u673a\u8bb0\u5f55\u4fdd\u7559');}
        if(data.version!==1||!Number.isSafeInteger(data.cursor)||data.cursor<progress.cursor||!Array.isArray(data.records)||data.records.length>100||!Array.isArray(data.accepted)||data.accepted.length>50||typeof data.has_more!=='boolean'||[...data.accepted,...data.records].some(row=>!normalizeReinforceRecord(row)))throw new Error('\u5f3a\u5316\u5386\u53f2\u54cd\u5e94\u65e0\u6548\uff0c\u672c\u673a\u8bb0\u5f55\u4fdd\u7559');
        const active=config();if(!active||active.server!==latest.server||active.client_id!==latest.client_id||active.token!==latest.token)return;
        for(const remote of [...data.accepted,...data.records]){const key=PREFIX+JSON.stringify([remote.character,remote.uuid]);let local=null;try{local=JSON.parse(localStorage.getItem(key)||'null');}catch{}const merged=mergeReinforceRecord(local,remote);if(!merged)throw new Error('\u5f3a\u5316\u5386\u53f2\u5408\u5e76\u5931\u8d25\uff0c\u672c\u673a\u8bb0\u5f55\u4fdd\u7559');const value=JSON.stringify(merged);if(localStorage.getItem(key)!==value){localStorage.setItem(key,value);window.dispatchEvent(new StorageEvent('storage',{key,newValue:value}));}progress.sent[key]=await hash(normalizeReinforceRecord(remote));}
        progress.cursor=data.cursor;progress.checked=Date.now();localStorage.setItem(KEY,JSON.stringify(progress));status('\u5f3a\u5316\u8bb0\u5f55\u5df2\u540c\u6b65');if(data.has_more||waiting)schedule(1000);
      };if(navigator.locks?.request)await navigator.locks.request('aether-history-network',run);else await run();}
      catch(error){status(error.name==='AbortError'?'\u5f3a\u5316\u8bb0\u5f55\u540c\u6b65\u8d85\u65f6\uff0c\u672c\u673a\u8bb0\u5f55\u4fdd\u7559':error.message||'\u5f3a\u5316\u8bb0\u5f55\u540c\u6b65\u5931\u8d25\uff0c\u672c\u673a\u8bb0\u5f55\u4fdd\u7559');}
      finally{busy=false;if(!paused)schedule(30000);}
    }
    window.addEventListener('aether-history-change',()=>schedule());window.addEventListener('aether-history-sync-now',()=>{paused=false;synchronize(true);});window.addEventListener('online',()=>{paused=false;schedule();});window.addEventListener('storage',event=>{if(event.key===CONFIG){paused=false;status('\u6b63\u5728\u68c0\u67e5\u5f3a\u5316\u8bb0\u5f55\u8fde\u63a5');schedule();}else if(event.key?.startsWith(PREFIX))schedule();});document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});status(config()?'\u5f3a\u5316\u8bb0\u5f55\u5df2\u8fde\u63a5\uff0c\u7b49\u5f85\u540c\u6b65':'\u5f3a\u5316\u8bb0\u5f55\u4ec5\u5b58\u672c\u673a\uff0c\u8fde\u63a5\u7f6e\u9876\u4e91\u540c\u6b65\u540e\u81ea\u52a8\u540c\u6b65');schedule(1500);
  }
  function initPinSync(){
    if(window.top!==window||window[Symbol.for('aether.pin.sync')])return;window[Symbol.for('aether.pin.sync')]=true;
    const KEY='aether-pin-sync-v1',PREFIX='aether-bag-pins-v1:',DRAFT='aether-pin-draft-v1:',DEFAULT_SERVER='https://inf.muge.zj.cn';let busy=false,timer=null,message='\u672a\u8fde\u63a5\u4e91\u540c\u6b65',paused=false;
    const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),value=>value.toString(16).padStart(2,'0')).join('');
    function validServer(value){try{const url=new URL(value);return url.origin===value&&(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname));}catch{return false;}}
    function load(){try{const value=JSON.parse(localStorage.getItem(KEY)||'null');return value?.version===1&&validServer(value.server)&&typeof value.token==='string'&&/^[A-Za-z0-9_-]{32,128}$/.test(value.token)&&typeof value.client_id==='string'&&Array.isArray(value.pending)?value:null;}catch{return null;}}
    function save(value){try{localStorage.setItem(KEY,JSON.stringify(value));return true;}catch{paused=true;message='\u65e0\u6cd5\u4fdd\u5b58\u540c\u6b65\u961f\u5217\uff0c\u5df2\u6682\u505c\uff1b\u672c\u673a\u7f6e\u9876\u4ecd\u4fdd\u7559';render();return false;}}
    function locked(name,fn){return navigator.locks?.request?navigator.locks.request('aether-pins-'+name,fn):Promise.resolve().then(fn);}
    function snapshots(){const result=new Map();for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith(PREFIX))continue;try{const values=JSON.parse(localStorage.getItem(key));if(Array.isArray(values))result.set(key.slice(PREFIX.length),values.filter(value=>typeof value==='string').slice(0,2000));}catch{}}return Object.fromEntries(result);}
    function drafts(config){const values=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith(DRAFT+config.client_id+':'))continue;try{const value=JSON.parse(localStorage.getItem(key));if(value&&typeof value.character==='string'&&typeof value.uuid==='string'&&typeof value.pinned==='boolean')values.push({key,character:value.character,uuid:value.uuid,pinned:value.pinned,order:value.order||0});}catch{}}return values.sort((a,b)=>a.order-b.order||a.key.localeCompare(b.key));}
    function flush(config){const batch=drafts(config);for(const draft of batch){config.next_seq++;config.pending.push({seq:config.next_seq,character:draft.character,uuid:draft.uuid,pinned:draft.pinned});}if(!save(config))throw new Error(message);for(const draft of batch)localStorage.removeItem(draft.key);return config;}
    function apply(data,config){const result=new Map(Object.entries(data.characters).map(([role,values])=>[role,new Set(values)]));for(const op of config.pending){if(!result.has(op.character))result.set(op.character,new Set());op.pinned?result.get(op.character).add(op.uuid):result.get(op.character).delete(op.uuid);}for(const role of Object.keys(snapshots()))if(!result.has(role))result.set(role,new Set());for(const [role,values]of result){const key=PREFIX+role,value=JSON.stringify([...values]);if(localStorage.getItem(key)===value)continue;localStorage.setItem(key,value);window.dispatchEvent(new StorageEvent('storage',{key,newValue:value}));}}
    const modal=element('section',undefined,'amv-pin-modal'),card=element('div',undefined,'amv-pin-card'),title=element('strong','\u7f6e\u9876\u4e91\u540c\u6b65'),intro=element('p','\u5728 Mugen-Web \u751f\u6210\u672c\u8bbe\u5907\u540c\u6b65\u7801\uff0c\u518d\u7c98\u8d34\u8fde\u63a5\u3002\u540c\u6b65\u88c5\u5907\u7f6e\u9876\u3001\u52a9\u6218\u597d\u53cb\u7f6e\u9876\u3001\u5f3a\u5316\u8bb0\u5f55\u3001\u81ea\u5b9a\u4e49\u88c5\u5907\u9884\u8bbe\u548c\u8d26\u53f7\u6392\u5e8f\u4e0e\u5907\u6ce8\u3002\u4e0b\u65b9\u9996\u6b21\u540c\u6b65\u65b9\u5f0f\u53ea\u5f71\u54cd\u7f6e\u9876\u3002'),link=element('a','\u6253\u5f00\u8bbe\u5907\u7ba1\u7406'),input=element('textarea'),choices=element('div',undefined,'amv-pin-choices'),feedback=element('p'),connect=button('\u8fde\u63a5\u5e76\u540c\u6b65',bind),manual=button('\u7acb\u5373\u540c\u6b65',()=>{paused=false;window.dispatchEvent(new Event('aether-history-sync-now'));window.dispatchEvent(new Event('aether-loadout-sync-now'));window.dispatchEvent(new Event('aether-role-sync-now'));window.dispatchEvent(new Event('aether-support-sync-now'));synchronize(true);}),disconnect=button('\u65ad\u5f00\u672c\u673a',unbind),close=button('\u5173\u95ed',()=>modal.hidden=true);let mode='merge';
    modal.hidden=true;modal.dataset.amvPinDialog='';card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');card.setAttribute('aria-label','\u7f6e\u9876\u4e91\u540c\u6b65');input.rows=3;input.placeholder='\u7c98\u8d34 AETHEROS1. \u5f00\u5934\u7684\u8bbe\u5907\u540c\u6b65\u7801';input.setAttribute('aria-label','\u8bbe\u5907\u540c\u6b65\u7801');link.target='_blank';link.rel='noopener noreferrer';link.href=DEFAULT_SERVER+'/admin/aether/sync';feedback.setAttribute('role','status');for(const [value,label]of [['merge','\u5408\u5e76\u672c\u673a\u4e0e\u4e91\u7aef'],['local','\u672c\u673a\u5df2\u6709\u89d2\u8272\u4e3a\u51c6'],['cloud','\u4f7f\u7528\u4e91\u7aef\u7f6e\u9876']]){const option=button(label,()=>{mode=value;choices.querySelectorAll('button').forEach(node=>node.setAttribute('aria-pressed',String(node===option)));});option.dataset.amvPinMode=value;option.setAttribute('aria-pressed',String(value===mode));choices.append(option);}const actions=element('div',undefined,'amv-pin-actions');actions.append(connect,manual,disconnect,close);card.append(title,intro,link,input,choices,feedback,actions);modal.append(card);document.body.append(modal);
    const style=element('style');style.textContent=`.amv-pin-modal{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:16px;background:#080d17a8;box-sizing:border-box}.amv-pin-modal[hidden]{display:none!important}.amv-pin-card{width:min(480px,100%);max-height:calc(100dvh - 32px);overflow:auto;box-sizing:border-box;padding:20px;border:1px solid #ffffff24;border-radius:14px;background:#242930;color:#e7e9ed;box-shadow:0 12px 40px #0006;font:13px/1.6 system-ui}.amv-pin-card p{color:#aab7c7;margin:10px 0}.amv-pin-card strong{font-size:16px}.amv-pin-card a{color:#9ad6c1}.amv-pin-card textarea{display:block;width:100%;box-sizing:border-box;resize:vertical;margin:12px 0;padding:9px;border:1px solid #ffffff25;border-radius:7px;background:#111821;color:inherit;font:12px/1.5 system-ui}.amv-pin-card button{margin:0;padding:6px 9px;border:1px solid #ffffff20;border-radius:6px;background:#ffffff08;color:inherit;font:12px/1.5 system-ui;cursor:pointer}.amv-pin-card button:disabled{opacity:.4;cursor:default}.amv-pin-card button[aria-pressed=true]{border-color:#8dceb8;color:#a7e2cd}.amv-pin-choices,.amv-pin-actions{display:flex;gap:6px;flex-wrap:wrap}.amv-pin-card :focus-visible{outline:2px solid #8dceb8;outline-offset:2px}`;document.head.append(style);
    function render(){const config=load();if(config&&message==='\u672a\u8fde\u63a5\u4e91\u540c\u6b65')message='\u5df2\u8fde\u63a5\uff0c\u7b49\u5f85\u540c\u6b65';feedback.textContent=message+(config?.pending.length?' \u00b7 \u5f85\u540c\u6b65 '+config.pending.length+' \u9879':'');manual.disabled=busy||!config;disconnect.disabled=busy||!config;connect.disabled=busy;input.disabled=busy;link.href=(config?.server||DEFAULT_SERVER)+'/admin/aether/sync';for(const node of document.querySelectorAll('[data-amv-pin-open]'))node.title='\u7f6e\u9876\u4e91\u540c\u6b65\uff1a'+message;}
    function schedule(delay=500){clearTimeout(timer);if(load()&&!paused)timer=setTimeout(()=>synchronize(),delay);}
    async function synchronize(force=false){if(busy||paused&&!force||!load())return;if(document.hidden&&!force){schedule(30000);return;}busy=true;render();try{await locked('network',async()=>{const sent=await locked('queue',()=>{const config=load();if(!config)return null;flush(config);return {server:config.server,token:config.token,client_id:config.client_id,initial:config.initial,operations:config.pending.slice(0,500)};});if(!sent)return;const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);let response,data;try{response=await fetch(sent.server+'/api/aetheros/pins/sync',{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',headers:{'Content-Type':'application/json','Authorization':'Bearer '+sent.token},body:JSON.stringify({client_id:sent.client_id,initial:sent.initial,operations:sent.operations}),signal:controller.signal});data=await response.json().catch(()=>({}));}finally{clearTimeout(timeout);}if(!response.ok){if([401,403,409,413,422].includes(response.status))paused=true;throw new Error(response.status===404?'\u540c\u6b65\u670d\u52a1\u5c1a\u672a\u66f4\u65b0\uff0c\u8bf7\u5148\u66f4\u65b0 Mugen-Web':typeof data.detail==='string'?data.detail:'\u540c\u6b65\u670d\u52a1\u6682\u4e0d\u53ef\u7528');}if(data.version!==1||!Number.isSafeInteger(data.ack)||!Number.isSafeInteger(data.revision)||data.ack<0||data.revision<0||!data.characters||typeof data.characters!=='object'||Array.isArray(data.characters)||Object.values(data.characters).some(values=>!Array.isArray(values)||values.some(value=>typeof value!=='string')))throw new Error('\u540c\u6b65\u54cd\u5e94\u65e0\u6548\uff0c\u4fdd\u7559\u672c\u673a\u6570\u636e');await locked('queue',()=>{const config=load();if(!config||config.client_id!==sent.client_id||config.token!==sent.token)return;flush(config);config.pending=config.pending.filter(op=>op.seq>data.ack);config.initial=null;config.next_seq=Math.max(config.next_seq,data.ack);config.revision=data.revision;if(!save(config))throw new Error(message);apply(data,config);});message='\u7f6e\u9876\u5df2\u540c\u6b65';window.dispatchEvent(new Event('aether-history-sync-now'));if(sent.initial){window.dispatchEvent(new Event('aether-loadout-sync-now'));window.dispatchEvent(new Event('aether-role-sync-now'));window.dispatchEvent(new Event('aether-support-sync-now'));}});}catch(error){message=error.name==='AbortError'?'\u8fde\u63a5\u8d85\u65f6\uff0c\u7f6e\u9876\u4fdd\u7559\u5728\u672c\u673a':error instanceof TypeError?'\u6682\u65f6\u79bb\u7ebf\uff0c\u7f6e\u9876\u4fdd\u7559\u5728\u672c\u673a':error.message||'\u6682\u65f6\u79bb\u7ebf\uff0c\u7f6e\u9876\u4fdd\u7559\u5728\u672c\u673a';}finally{busy=false;render();const config=load();if(config&&!paused)schedule(config.pending.length?5000:30000);}}
    async function bind(){if(busy)return;if(!navigator.locks?.request){message='\u6b64\u6d4f\u89c8\u5668\u7f3a\u5c11\u540c\u6b65\u9501\u652f\u6301\uff0c\u8bf7\u66f4\u65b0\u6d4f\u89c8\u5668\u540e\u8fde\u63a5';render();return;}let payload;try{const text=input.value.trim();if(!text.startsWith('AETHEROS1.'))throw new Error();payload=JSON.parse(atob(text.slice(10).replaceAll('-','+').replaceAll('_','/')));if(payload.version!==1||!validServer(payload.server)||!/^[A-Za-z0-9_-]{32,128}$/.test(payload.token))throw new Error();}catch{message='\u8bbe\u5907\u540c\u6b65\u7801\u683c\u5f0f\u4e0d\u6b63\u786e';render();return;}if(mode==='local'&&!confirm('\u5c06\u4ee5\u672c\u673a\u5df2\u6709\u89d2\u8272\u7684\u7f6e\u9876\u4e3a\u51c6\u8986\u76d6\u4e91\u7aef\u5bf9\u5e94\u89d2\u8272\uff0c\u7ee7\u7eed\uff1f'))return;if(load()&&!confirm('\u66f4\u6362\u5f53\u524d\u8fde\u63a5\uff1f\u672c\u673a\u7f6e\u9876\u4f1a\u4fdd\u7559\uff0c\u8bf7\u786e\u8ba4\u9996\u6b21\u540c\u6b65\u65b9\u5f0f\u3002'))return;const config={version:1,server:payload.server,token:payload.token,client_id:random(),next_seq:0,pending:[],initial:{mode,characters:snapshots()},revision:0};paused=false;if(!save(config))return;input.value='';message='\u6b63\u5728\u8fde\u63a5\u2026';await synchronize(true);}
    async function unbind(){if(!confirm('\u65ad\u5f00\u672c\u673a\u540c\u6b65\uff1f\u672c\u673a\u7f6e\u9876\u4f1a\u4fdd\u7559\uff1b\u672a\u540c\u6b65\u4fee\u6539\u53ef\u5728\u4e0b\u6b21\u8fde\u63a5\u65f6\u5408\u5e76\u3002'))return;await locked('queue',()=>{localStorage.removeItem(KEY);});clearTimeout(timer);paused=false;message='\u5df2\u65ad\u5f00\uff0c\u672c\u673a\u7f6e\u9876\u4fdd\u7559';render();}
    window.addEventListener('aether-pin-change',event=>{const detail=event.detail,config=load();if(!config||!detail||typeof detail.character!=='string'||typeof detail.uuid!=='string'||typeof detail.pinned!=='boolean')return;try{const existing=drafts(config),order=Math.max(0,...existing.map(value=>value.order||0))+1;localStorage.setItem(DRAFT+config.client_id+':'+random(),JSON.stringify({character:detail.character,uuid:detail.uuid,pinned:detail.pinned,order}));locked('queue',()=>{const latest=load();if(latest?.client_id===config.client_id)flush(latest);}).then(()=>{render();schedule();}).catch(()=>{message='\u540c\u6b65\u961f\u5217\u65e0\u6cd5\u4fdd\u5b58\uff0c\u8bf7\u4fdd\u7559\u672c\u673a\u6570\u636e\u5e76\u91cd\u65b0\u8fde\u63a5';paused=true;render();});}catch{message='\u540c\u6b65\u961f\u5217\u65e0\u6cd5\u4fdd\u5b58\uff0c\u8bf7\u4fdd\u7559\u672c\u673a\u6570\u636e\u5e76\u91cd\u65b0\u8fde\u63a5';paused=true;render();}});
    const historyFeedback=element('p'),loadoutFeedback=element('p'),loadoutLink=element('a','\u5728 Web \u67e5\u770b\u88c5\u5907\u9884\u8bbe');loadoutLink.hidden=true;const roleFeedback=element('p');const supportFeedback=element('p');feedback.after(historyFeedback,loadoutFeedback,roleFeedback,supportFeedback,loadoutLink);window.addEventListener('aether-support-sync-status',event=>{supportFeedback.textContent=event.detail;});window.addEventListener('aether-role-sync-status',event=>{roleFeedback.textContent=event.detail;});window.addEventListener('aether-loadout-sync-status',event=>{loadoutFeedback.textContent=event.detail.message;loadoutLink.hidden=!event.detail.server;if(event.detail.server)loadoutLink.href=event.detail.server+'/admin/aether?character_view=presets#aether-equipment';});window.addEventListener('aether-history-sync-status',event=>{historyFeedback.textContent=event.detail.message;});
    window.addEventListener('aether-pins-settings',()=>{modal.hidden=false;render();close.focus();});modal.addEventListener('click',event=>{if(event.target===modal)modal.hidden=true;});modal.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape')modal.hidden=true;if(event.key==='Tab'){const controls=[...card.querySelectorAll('a[href],button:not(:disabled),textarea:not(:disabled)')],first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});window.addEventListener('online',()=>schedule(100));document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule(100);});window.addEventListener('storage',event=>{if(event.key===KEY)render();});render();schedule(1000);
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
    const notice=element('section'),title=element('strong'),description=element('p'),actions=element('div',undefined,'asu-actions'),link=element('a','\u66f4\u65b0\u811a\u672c'),retry=button('\u91cd\u8bd5',()=>check(true)),later=button('\u7a0d\u540e',dismiss);notice.id='aether-script-update';notice.hidden=true;notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');link.target='_blank';link.rel='noopener noreferrer';link.dataset.asuInstall='';retry.dataset.asuRetry='';later.dataset.asuLater='';actions.append(link,retry,later);notice.append(title,description,actions);document.body.append(notice);
    function dismiss(){if(noticeVersion){const value=read();save({...value,dismissedVersion:noticeVersion,dismissedAt:Date.now()});}notice.hidden=true;}
    function show(kind,value){noticeVersion=kind==='update'?value:'';notice.dataset.state=kind;link.hidden=kind!=='update'&&kind!=='error';retry.hidden=kind!=='error';later.textContent=kind==='update'?'\u7a0d\u540e':'\u5173\u95ed';link.textContent=kind==='update'?'\u66f4\u65b0\u811a\u672c':'\u67e5\u770b GitHub';link.href=kind==='update'?INSTALL+'?v='+encodeURIComponent(value):RELEASES;if(kind==='update'){title.textContent='AetherOS \u6709\u65b0\u7248\u672c v'+value;description.textContent='\u5f53\u524d v'+SCRIPT_VERSION+'\uff0c\u70b9\u51fb\u5b89\u88c5\u66f4\u65b0\u540e\u5237\u65b0\u6e38\u620f\u5b98\u7f51\u3002';}else if(kind==='checking'){title.textContent='\u6b63\u5728\u68c0\u67e5\u66f4\u65b0\u2026';description.textContent='\u4ece GitHub \u8bfb\u53d6\u7248\u672c\u4fe1\u606f\u3002';}else if(kind==='latest'){title.textContent='\u5df2\u662f\u6700\u65b0\u7248\u672c v'+SCRIPT_VERSION;description.textContent='\u5f53\u524d\u811a\u672c\u65e0\u9700\u66f4\u65b0\u3002';}else{title.textContent='\u6682\u65f6\u65e0\u6cd5\u68c0\u67e5\u66f4\u65b0';description.textContent='\u672a\u80fd\u8fde\u63a5 GitHub\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\uff0c\u6e38\u620f\u529f\u80fd\u4e0d\u53d7\u5f71\u54cd\u3002';}notice.hidden=false;}
    function offer(value,force=false){if(!newer(value.latest))return;if(!force&&value.dismissedVersion===value.latest&&recent(value.dismissedAt,DAY))return;show('update',value.latest);}
    async function check(force=false){if(checking||document.hidden&&!force)return;cache=read();offer(cache,force);if(!force&&(recent(cache.checkedAt,DAY)||recent(cache.lastAttempt,HOUR)))return;checking=true;save({...read(),lastAttempt:Date.now()});if(force)show('checking');const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
      try{
        // 只读取公开版本文件，不携带游戏凭证，也不下载或执行远程代码。
        const response=await fetch(META+'?check='+Date.now(),{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('\u7248\u672c\u8bfb\u53d6\u5931\u8d25');const text=await response.text();if(text.length>32768||!/^\/\/\s*@namespace\s+mugen\.aether\.multiview\s*$/m.test(text))throw new Error('\u7248\u672c\u6587\u4ef6\u4e0d\u5339\u914d');const latest=version(text.match(/^\/\/\s*@version\s+(\S+)\s*$/m)?.[1]);if(!latest)throw new Error('\u7248\u672c\u683c\u5f0f\u65e0\u6548');save({...read(),checkedAt:Date.now(),latest});if(newer(latest))offer(read(),force);else if(force)show('latest');
      }catch{if(force)show('error');}finally{clearTimeout(timeout);checking=false;}
    }
    function schedule(){clearTimeout(timer);timer=setTimeout(()=>check(),UPDATE_DELAY);}
    window.addEventListener('aether-userscript-check-updates',()=>check(true));window.addEventListener('storage',event=>{if(event.key===KEY){cache=read();offer(cache);}});document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});window.addEventListener('pageshow',schedule);cache=read();offer(cache);schedule();
  }
  const SAVED_GEAR={weapon:'\u6b66\u5668',top:'\u4e0a\u8863',bottom:'\u4e0b\u88c5',gloves:'\u624b\u90e8',shoes:'\u978b\u5b50',accessory:'\u9970\u54c1'};
  const SAVED_SKILLS={addon:'\u9644\u52a0\u6280\u80fd',custom:'\u81ea\u5b9a\u4e49\u6280\u80fd',aether:'\u4ee5\u592a\u7206\u53d1'};
  const SAVED_PRISMS={core:'\u7eaf\u51c0',red:'\u7ea2\u8272',blue:'\u84dd\u8272',green:'\u7eff\u8272'};
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
    if(!Array.isArray(status?.equipment_slots)||!Array.isArray(status?.skills?.slots)||!prism?.equipped)throw Error('\u5b98\u7f51\u914d\u88c5\u6570\u636e\u4e0d\u5b8c\u6574');
    const equipment={},skills={},spectra={};
    for(const slot of Object.keys(SAVED_GEAR)){
      const row=status.equipment_slots.find(value=>value.slot===slot);
      if(!row||row.item&&typeof row.item.uuid!=='string')throw Error('\u65e0\u6cd5\u8bfb\u53d6'+SAVED_GEAR[slot]);
      equipment[slot]=row.item?{uuid:row.item.uuid,name:row.item.name||row.item.uuid,icon:loadoutItemIcon(row.item.icon)}:null;
    }
    for(const slot of Object.keys(SAVED_SKILLS)){
      const row=status.skills.slots.find(value=>value.slot===slot),choices=status.skills.available?.[slot];
      if(!row||!choices||!Object.hasOwn(choices,'selected'))throw Error('\u65e0\u6cd5\u8bfb\u53d6'+SAVED_SKILLS[slot]);
      const code=choices.selected;
      if(code!==null&&typeof code!=='string')throw Error(SAVED_SKILLS[slot]+'\u7f16\u53f7\u65e0\u6548');
      const option=choices.options?.find(value=>value.skill_code===code),skill=option?.skill||row.skill;
      skills[slot]=code?{code,name:skill?.name||code,element:presetSkillElement(option,skill)}:null;
    }
    for(const color of Object.keys(SAVED_PRISMS)){
      const rows=prism.equipped[color];
      if(!Array.isArray(rows)||rows.some(row=>typeof row?.talent_id!=='string'||!row.talent_id))throw Error('\u65e0\u6cd5\u8bfb\u53d6'+SAVED_PRISMS[color]+'\u5149\u8c31');
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
      if(!item||item.broken||item.slot!==slot)throw Error(label+'\u300c'+desired.name+'\u300d\u5df2\u4e0d\u53ef\u7528');
    }
    for(const [color,label] of Object.entries(SAVED_PRISMS)){
      const ids=prismIds(target,color),owned=new Set([...(world.prism.owned?.[color]||[]),...(world.prism.equipped[color]||[])].map(row=>row.talent_id));
      if(ids.length>(world.prism.slots?.[color]??0)||ids.some(id=>!owned.has(id)))throw Error(label+'\u5149\u8c31\u6709\u672a\u89e3\u9501\u7684\u69fd\u4f4d\u6216\u5df2\u4e0d\u53ef\u7528\u7684\u5149\u8c31');
    }
    const send=async(label,path,body)=>{progress(label);try{await write(path,body);changes++;}catch(error){throw Error(label+'\u5931\u8d25\uff1a'+error.message);}};
    for(const [slot,label] of Object.entries(SAVED_GEAR)){
      const desired=target.equipment[slot];
      if(desired?.uuid===current.equipment[slot]?.uuid)continue;
      if(desired)await send('\u7a7f\u6234'+label,'/status/equip',{slot,entry_uuid:desired.uuid});
      else await send('\u5378\u4e0b'+label,'/status/unequip',{slot});
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
      if(expected.length>(world.prism.slots?.[color]??0)||expected.slice(prefix).some(id=>!owned.has(id)||owned.get(id).requirement_met===false))throw Error(label+'\u5149\u8c31\u88c5\u586b\u6761\u4ef6\u672a\u6ee1\u8db3');
      prismChanges.push({color,label,expected,actual,prefix});
    }
    for(const {color,label,expected,actual,prefix} of prismChanges){
      for(let index=actual.length-1;index>=prefix;index--)await send('\u5378\u4e0b'+label+'\u5149\u8c31\u7b2c '+(index+1)+' \u683c','/prism/uninstall',{spectrum:color,index});
      for(const talent_id of expected.slice(prefix))await send('\u88c5\u586b'+label+'\u5149\u8c31','/prism/install',{spectrum:color,talent_id});
    }
    if(changes!==gearChanges){world=await read();current=world.build;}
    for(const [slot,label] of Object.entries(SAVED_SKILLS)){
      const desired=target.skills[slot];
      if(desired?.code===current.skills[slot]?.code)continue;
      const option=world.status.skills.available[slot]?.options?.find(row=>row.skill_code===desired?.code);
      if(desired&&(!option||option.can_equip===false))throw Error(label+'\u300c'+desired.name+'\u300d\u5f53\u524d\u4e0d\u80fd\u88c5\u914d');
      await send('\u5207\u6362'+label,'/status/skills',{slot,skill_code:desired?.code??null});
    }
    if(changes)current=(await read()).build;
    for(const [slot,label] of Object.entries(SAVED_GEAR))if(current.equipment[slot]?.uuid!==target.equipment[slot]?.uuid)throw Error(label+'\u6838\u5bf9\u5931\u8d25');
    for(const [slot,label] of Object.entries(SAVED_SKILLS))if(current.skills[slot]?.code!==target.skills[slot]?.code)throw Error(label+'\u6838\u5bf9\u5931\u8d25');
    for(const [color,label] of Object.entries(SAVED_PRISMS))if(JSON.stringify(prismIds(current,color))!==JSON.stringify(prismIds(target,color)))throw Error(label+'\u5149\u8c31\u987a\u5e8f\u6838\u5bf9\u5931\u8d25');
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
      if(!Array.isArray(rows)||!rows.every(row=>validLoadoutChange(row)&&row.character===character))throw Error('\u672c\u673a\u9884\u8bbe\u683c\u5f0f\u65e0\u6548');
      return rows;
    }
    const legacy=JSON.parse(localStorage.getItem(LEGACY_LOADOUTS+character)||'[]');
    if(!Array.isArray(legacy)||!legacy.every(row=>typeof row?.id==='string'&&row.id&&validLoadout(row)))throw Error('\u672c\u673a\u9884\u8bbe\u683c\u5f0f\u65e0\u6548');
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
      if(!response.ok)throw Error(response.status===404?'Web \u5c1a\u672a\u66f4\u65b0\uff0c\u9884\u8bbe\u4fdd\u7559\u5728\u672c\u673a':typeof data.detail==='string'?data.detail:'\u88c5\u5907\u9884\u8bbe\u540c\u6b65\u6682\u4e0d\u53ef\u7528');
      if(data.version!==1||!isLoadoutStamp(data.cursor)||typeof data.has_more!=='boolean'||
        !Array.isArray(data.changes)||data.changes.length>40||!data.changes.every(validLoadoutChange)||
        !Array.isArray(data.accepted)||data.accepted.length!==changes.length||
        !data.accepted.every((row,index)=>validLoadoutChange(row)&&row.character===changes[index].character&&row.id===changes[index].id))throw Error('\u88c5\u5907\u9884\u8bbe\u540c\u6b65\u54cd\u5e94\u65e0\u6548');
      const active=config();
      if(active?.server!==current.server||active?.token!==current.token||active?.client_id!==current.client_id)return;
      storeChanges([...data.accepted,...data.changes]);
      localStorage.setItem(stateKey,JSON.stringify({server:current.server,cursor:data.cursor}));
      status('\u88c5\u5907\u9884\u8bbe\u5df2\u540c\u6b65',current.server);
      requested ||= waiting||data.has_more;
    }
    async function synchronize(){
      if(busy){requested=true;return;}
      const current=config();
      if(!current){status('\u88c5\u5907\u9884\u8bbe\u4fdd\u7559\u5728\u672c\u673a\uff0c\u8fde\u63a5\u4e91\u540c\u6b65\u540e\u81ea\u52a8\u4e0a\u4f20');return;}
      if(document.hidden){schedule(60000);return;}
      busy=true;requested=false;
      try{
        await navigator.locks.request('aether-loadout-sync',async()=>{
          if(config()?.token===current.token)await exchange(current);
        });
        offline=false;
      }catch(error){
        offline=true;
        status((error.name==='AbortError'||error instanceof TypeError?'\u88c5\u5907\u9884\u8bbe\u6682\u65f6\u65e0\u6cd5\u8fde\u63a5 Web':error.message)+'\uff0c\u672c\u673a\u6570\u636e\u5df2\u4fdd\u7559',current.server);
      }finally{
        busy=false;schedule(!offline&&requested?700:60000);
      }
    }
    window.addEventListener('aether-loadout-change',()=>schedule());
    window.addEventListener('aether-loadout-sync-now',()=>schedule(0));
    window.addEventListener('storage',event=>{if(event.key===configKey||event.key?.startsWith(CLOUD_LOADOUTS))schedule();});
    window.addEventListener('online',()=>schedule(0));
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
    status(config()?'\u88c5\u5907\u9884\u8bbe\u7b49\u5f85\u540c\u6b65':'\u88c5\u5907\u9884\u8bbe\u4fdd\u7559\u5728\u672c\u673a\uff0c\u8fde\u63a5\u4e91\u540c\u6b65\u540e\u81ea\u52a8\u4e0a\u4f20');
    schedule(1500);
  }

  function initCustomLoadouts(){
    const guard=Symbol.for('aether.custom.loadouts');if(window[guard])return;window[guard]=true;
    const role=()=>sessionStorage.getItem(ACTIVE)?.trim()||'';
    const load=who=>orderedLoadouts(loadoutDocument(who)).map(row=>({...row.preset,id:row.id,updatedAt:row.stamp}));
    function save(who,id,transform){
      const records=loadoutDocument(who),rows=orderedLoadouts(records),old=rows.find(row=>row.id===id);
      if(id&&!old)throw Error('\u6b64\u9884\u8bbe\u5df2\u5728\u53e6\u4e00\u4e2a\u7a97\u53e3\u4fee\u6539\uff0c\u8bf7\u91cd\u65b0\u6253\u5f00');
      if(!old&&rows.length>=50)throw Error('\u6bcf\u4e2a\u89d2\u8272\u6700\u591a\u4fdd\u5b58 50 \u5957');
      const next=transform(old?{...old.preset,id:old.id,updatedAt:old.stamp}:undefined);
      const {id:identifier,updatedAt,...preset}=next||old||{};
      const stamp=Math.max(Date.now(),(old?.stamp??0)+1);
      const order=old?.order??Math.max(Date.now(),(rows.at(-1)?.order??0)+1);
      const change={character:who,id:identifier,stamp,order,change_id:crypto.randomUUID(),preset:next?preset:null,dirty:true};
      localStorage.setItem(CLOUD_LOADOUTS+who,JSON.stringify([...records.filter(row=>row.id!==identifier),change]));
      window.dispatchEvent(new Event('aether-loadout-change'));
    }
    async function request(who,path,body){
      if(role()!==who)throw Error('\u5f53\u524d\u89d2\u8272\u5df2\u5207\u6362');
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
      try{
        const url=new URL('/api/aether'+path,ORIGIN);url.searchParams.set('_aether_character',who);
        const response=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:controller.signal});
        const payload=await response.json().catch(()=>null);
        if(!response.ok||payload?.code!==0)throw Error(payload?.message||'\u5b98\u7f51\u8bf7\u6c42\u5931\u8d25\uff08HTTP '+response.status+'\uff09');
        return payload.data;
      }catch(error){if(error.name==='AbortError')throw Error('\u5b98\u7f51\u54cd\u5e94\u8d85\u65f6\uff0c\u8bf7\u91cd\u65b0\u8bfb\u53d6\u5f53\u524d\u914d\u88c5');throw error;}
      finally{clearTimeout(timeout);}
    }
    async function read(who){
      const [status,prism]=await Promise.all([request(who,'/status'),request(who,'/prism')]);
      if(role()!==who)throw Error('\u5f53\u524d\u89d2\u8272\u5df2\u5207\u6362');
      return {status,prism,build:captureCustomLoadout(status,prism)};
    }
    async function lock(who,work){
      if(navigator.locks?.request)return navigator.locks.request('aether-custom-loadout:'+who,{ifAvailable:true},locked=>{if(!locked)throw Error('\u8be5\u89d2\u8272\u5728\u5176\u4ed6\u7a97\u53e3\u6709\u914d\u88c5\u64cd\u4f5c');return work();});
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
        if(!Array.isArray(data))throw Error('\u6280\u80fd\u56fe\u9274\u683c\u5f0f\u65e0\u6548');
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
      const section=element('section',undefined,'aosp-loadouts'),head=element('div',undefined,'aosp-loadout-head'),tabs=element('nav',undefined,'aosp-loadout-switch'),form=element('form',undefined,'aosp-loadout-form'),input=element('input'),submit=native('button','\u4fdd\u5b58','ae-btn ae-btn--primary'),list=native('div',undefined,'presets-list aosp-loadout-list'),feedback=element('p',undefined,'aosp-loadout-feedback');
      let busy=false,editor=null,character=role(),metadataChecked=false,metadataPending=false,catalogChecked=false,scrollToNew=false;
      let icons=new Map(),skillsByName=new Map(),skillsByCode=new Map();
      body.classList.add('aosp-loadout-layout');head.append(element('span','\u5b98\u65b9\u9884\u8bbe'),element('span','\u81ea\u5b9a\u4e49\u9884\u8bbe'));tabs.setAttribute('aria-label','\u88c5\u5907\u9884\u8bbe\u5206\u7c7b');section.setAttribute('aria-label','\u81ea\u5b9a\u4e49\u9884\u8bbe');
      const official=action('\u5b98\u65b9\u9884\u8bbe','mdi-bookmark-multiple-outline',()=>selectTab('official')),custom=action('\u81ea\u5b9a\u4e49\u9884\u8bbe','mdi-bookmark-plus-outline',()=>selectTab('custom'));
      function selectTab(value){body.dataset.aospTab=value;official.setAttribute('aria-pressed',String(value==='official'));custom.setAttribute('aria-pressed',String(value==='custom'));if(value==='custom'&&!busy)draw();}
      tabs.append(official,custom);selectTab('official');input.maxLength=60;input.required=true;input.setAttribute('aria-label','\u81ea\u5b9a\u4e49\u9884\u8bbe\u540d\u79f0');submit.type='submit';form.hidden=true;
      form.append(input,submit,action('\u53d6\u6d88','mdi-close',()=>{editor=null;form.hidden=true;}));feedback.setAttribute('role','status');section.append(form,feedback,list);body.prepend(tabs,head);body.append(section);
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
          const match=chip.textContent.trim().match(/^(?:\u9644\u52a0|\u81ea\u5b9a\u4e49|\u4ee5\u592a)\s*[:\uff1a]\s*(.+)$/);
          if(match)chip.dataset.aospSkillName=match[1];
          const name=chip.dataset.aospSkillName;if(!name)continue;
          chip.hidden=name==='\u65e0';if(chip.hidden)continue;
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
        if(!character){message('\u8bf7\u5148\u5728\u5b98\u7f51\u9009\u62e9\u89d2\u8272');return;}
        let rows;try{rows=load(character);}catch(error){message(error.message,true);return;}
        for(const row of rows){
          const card=native('article',undefined,'preset-card aosp-loadout-card'+(row.empty?' preset-card--empty':'')),top=native('div',undefined,'preset-card-top'),name=native('div',undefined,'preset-name'),actions=native('div',undefined,'preset-actions'),details=element('details',undefined,'aosp-loadout-details');
          name.append(native('strong',row.name,'preset-name-text'));if(row.empty)name.append(native('small','\u7a7a\u9884\u8bbe','preset-name-empty'));
          top.append(name,element('small','\u81ea\u5b9a\u4e49','aosp-loadout-badge'));
          const apply=action('\u5e94\u7528','mdi-check',()=>run(async who=>{
            if(!confirm('\u5e94\u7528\u300c'+row.name+'\u300d\uff1f\u8fd9\u4f1a\u66f4\u6362 '+who+' \u7684\u5f53\u524d\u914d\u88c5\u3002'))return;
            message('\u6b63\u5728\u6838\u5bf9 '+who+' \u7684\u914d\u88c5\u2026');
            let attempted=false;
            try{
              const count=await applyCustomLoadout(row,{read:()=>read(who),write:(path,data)=>{attempted=true;return request(who,path,data);},progress:label=>message(label+'\u2026')});
              message(count?'\u5df2\u5e94\u7528\u5e76\u6838\u5bf9\u300c'+row.name+'\u300d':'\u5f53\u524d\u914d\u88c5\u4e0e\u300c'+row.name+'\u300d\u4e00\u81f4');
            }catch(error){if(attempted)error.message+='\u3002\u53ef\u80fd\u5df2\u5b8c\u6210\u90e8\u5206\u5207\u6362\uff0c\u518d\u6b21\u5e94\u7528\u5c06\u4ece\u5b9e\u9645\u914d\u88c5\u7ee7\u7eed';throw error;}
            finally{if(attempted)refresh(who);}
          }),'ae-btn--primary');
          apply.disabled=!!row.empty;
          actions.append(apply,action('\u4fdd\u5b58','mdi-content-save',()=>{if(row.empty||confirm('\u7528\u5f53\u524d\u914d\u88c5\u8986\u76d6\u300c'+row.name+'\u300d\uff1f'))run(who=>capture(who,row.id,row.name));}),action('\u6539\u540d','mdi-pencil',()=>edit(row)),action('\u5220\u9664','mdi-delete',()=>{if(confirm('\u5220\u9664\u300c'+row.name+'\u300d\uff1f'))run(who=>{save(who,row.id,()=>null);message('\u5df2\u5220\u9664');});},'ae-btn--danger'));
          card.append(top);
          if(!row.empty){
            const gear=native('div',undefined,'preset-equip-row');
            for(const [key,label] of Object.entries(SAVED_GEAR)){
              const item=row.equipment[key],cell=native('div',undefined,'preset-equip-cell');
              cell.title=label+' \u00b7 '+(item?.name||'\u7a7a');cell.append(itemArt(item,key));gear.append(cell);
            }
            const skills=native('div',undefined,'preset-skills-row'),prism=native('div',undefined,'preset-prism-row');
            for(const skill of Object.values(row.skills))if(skill){const chip=native('span',undefined,'preset-skill-chip');paintSkill(chip,skill);skills.append(chip);}
            for(const key of Object.keys(SAVED_PRISMS))for(const item of row.spectra[key])prism.append(native('span',item.name,'preset-prism-chip preset-prism-chip--'+key));
            details.append(element('summary','\u67e5\u770b\u914d\u88c5'));
            for(const [key,label] of Object.entries(SAVED_GEAR))details.append(element('p',label+' \u00b7 '+(row.equipment[key]?.name||'\u7a7a')));
            for(const [key,label] of Object.entries(SAVED_SKILLS))details.append(element('p',label+' \u00b7 '+(row.skills[key]?.name||'\u7a7a')));
            for(const [key,label] of Object.entries(SAVED_PRISMS))details.append(element('p',label+'\u5149\u8c31 \u00b7 '+(row.spectra[key].map(item=>item.name).join(' \u2192 ')||'\u7a7a')));
            card.append(gear);if(skills.childElementCount)card.append(skills);if(prism.childElementCount){prism.prepend(native('span','\u68f1\u955c','preset-prism-label'));card.append(prism);}card.append(details);
          }
          card.append(actions);list.append(card);
        }
        const add=button('',()=>run(who=>{
          const names=new Set(load(who).map(row=>row.name));let index=1;while(names.has('\u81ea\u5b9a\u4e49\u9884\u8bbe '+index))index++;
          save(who,null,()=>({id:crypto.randomUUID(),name:'\u81ea\u5b9a\u4e49\u9884\u8bbe '+index,empty:true,updatedAt:Date.now()}));scrollToNew=true;message('\u5df2\u5efa\u7acb\u7a7a\u9884\u8bbe\uff0c\u70b9\u51fb\u300c\u4fdd\u5b58\u300d\u8bb0\u5f55\u5f53\u524d\u914d\u88c5');
        }));
        add.className='preset-card aosp-loadout-add';scoped(add);const plus=element('strong','+');plus.setAttribute('aria-hidden','true');add.append(plus,element('span','\u6dfb\u52a0\u81ea\u5b9a\u4e49\u9884\u8bbe'));list.append(add);
        if(scrollToNew){scrollToNew=false;add.previousElementSibling?.scrollIntoView({block:'nearest'});}
        restoreMetadata(rows);
      }
      async function run(task){
        if(busy||!character||role()!==character)return;
        busy=true;message('\u6b63\u5728\u5904\u7406\u2026');section.querySelectorAll('button,input').forEach(node=>node.disabled=true);
        try{await lock(character,()=>task(character));}catch(error){message(error.message||'\u64cd\u4f5c\u5931\u8d25',true);}
        finally{busy=false;section.querySelectorAll('button,input').forEach(node=>node.disabled=false);draw();}
      }
      async function capture(who,id,name){
        message('\u6b63\u5728\u8bfb\u53d6 '+who+' \u7684\u914d\u88c5\u2026');const {build}=await read(who);
        save(who,id,previous=>({id:previous?.id||crypto.randomUUID(),name,updatedAt:Date.now(),...build}));message('\u5df2\u4fdd\u5b58\u300c'+name+'\u300d');
      }
      form.addEventListener('submit',event=>{event.preventDefault();const name=input.value.trim(),draft=editor;if(!name||!draft)return;
        run(who=>{save(who,draft.id,row=>({...row,name,updatedAt:Date.now()}));message('\u5df2\u6539\u540d');editor=null;form.hidden=true;});
      });
      draw();
      return {section,refresh(force=false){const active=role();if(busy)return;if(character!==active){character=active;editor=null;metadataChecked=metadataPending=catalogChecked=false;icons=new Map();skillsByName=new Map();skillsByCode=new Map();form.hidden=true;message('');draw();}else if(force&&!editor)draw();else if(paintOfficial().some(skill=>!skillElement(skill))&&!editor)restoreMetadata([]);}};
    }
    const dialogs=new Map();let queued=false;
    function update(){queued=false;for(const [dialog,view]of dialogs)if(!dialog.isConnected||!view.section.isConnected)dialogs.delete(dialog);
      for(const dialog of document.querySelectorAll('.ae-dialog')){
        if(dialog.querySelector('.ae-dialog__title-text h2')?.textContent.trim()!=='\u88c5\u5907\u9884\u8bbe')continue;
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
    function dispatch(name){try{const detail=name==='aether-pins-settings'?{character:sessionStorage.getItem(ACTIVE)||''}:null;window.top.dispatchEvent(new window.top.CustomEvent(name,{detail}));}catch{window.dispatchEvent(new Event(name));}}
    const style=element('style');style.id='aether-multiview-official-layout';style.textContent=`
      html.amv-hide-idle .aether-console .console-layout:has(>.canvas-panel:not(.story-active)){grid-template-columns:minmax(0,1fr)!important}html.amv-hide-idle .aether-console .console-layout>.canvas-panel:not(.story-active){display:none!important}.settings-card .amv-settings-logo{display:block;width:16px;height:16px;flex-shrink:0;object-fit:contain;margin-right:4px}.amv-settings-page{padding:20px 24px;color:var(--text-primary,#dce5f4);font:inherit}.amv-settings-page h3{margin:0 0 15px;font-size:.9rem;font-weight:600}.amv-settings-row{display:flex;align-items:center;justify-content:space-between;gap:20px;cursor:pointer}.amv-settings-copy{display:flex;flex-direction:column;gap:5px}.amv-settings-copy strong{font-size:.86rem;font-weight:500}.amv-settings-page small{color:var(--text-muted,#9bacc4);font-size:.72rem;line-height:1.7}.amv-settings-switch{appearance:none;position:relative;flex:0 0 36px;width:36px;height:20px;margin:0;border:1px solid #ffffff28;border-radius:20px;background:#ffffff15;cursor:pointer}.amv-settings-switch:after{content:'';position:absolute;top:3px;left:3px;width:12px;height:12px;border-radius:50%;background:#a7b4c8;transition:transform .15s}.amv-settings-switch:checked{background:color-mix(in srgb,var(--accent,#61f4de) 25%,transparent);border-color:var(--accent,#61f4de)}.amv-settings-switch:checked:after{background:var(--accent,#61f4de);transform:translateX(16px)}.amv-settings-tools{display:flex;gap:8px;flex-wrap:wrap;margin-top:20px;padding-top:16px;border-top:1px solid #ffffff14}.amv-settings-tools button{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:7px 12px;border:1px solid #ffffff1c;border-radius:6px;background:#ffffff08;color:var(--text-primary,#dce5f4);font:inherit;font-size:.78rem;cursor:pointer}.amv-settings-tools button:hover{border-color:var(--accent,#61f4de);color:var(--accent,#61f4de)}.amv-settings-page footer{display:flex;gap:8px;align-items:center;justify-content:space-between;margin-top:16px}.amv-settings-page [role=status]{margin:0;font-size:.7rem;color:var(--text-muted,#9bacc4)}.amv-settings-switch:focus-visible,.amv-settings-tools button:focus-visible{outline:2px solid var(--accent,#61f4de);outline-offset:3px}@media(max-width:480px){.amv-settings-page{padding:16px}}
    `;document.head.append(style);apply();
    function attach(instance){
      if(instance[MARK]){states.add(instance[MARK]);return;}if(typeof instance.render!=='function')return;
      const original=instance.render,state={instance,message:''};instance[MARK]=state;states.add(state);
      // 沿用官网的页签与页面组件，字体、选中条、键盘操作及切换动画均交给官网。
      function vnode(type,props,children){return {__v_isVNode:true,__v_skip:true,type,props,key:props?.key??null,ref:null,scopeId:instance.type.__scopeId||null,slotScopeIds:null,children,component:null,suspense:null,ssContent:null,ssFallback:null,dirs:null,transition:null,el:null,anchor:null,target:null,targetStart:null,targetAnchor:null,staticCount:0,shapeFlag:1|(Array.isArray(children)?16:typeof children==='string'?8:0),patchFlag:0,dynamicProps:null,dynamicChildren:null,appContext:null,ctx:instance};}
      const text=(type,value,props={})=>vnode(type,props,value);
      function page(){return vnode('div',{class:'settings-body amv-settings-page','data-amv-settings-page':''},[
        text('h3','\u754c\u9762\u663e\u793a'),vnode('label',{class:'amv-settings-row'},[vnode('span',{class:'amv-settings-copy'},[text('strong','\u9690\u85cf\u5de6\u4fa7\u7a7a\u95f2\u9ed1\u5c4f'),text('small','\u666e\u901a\u9875\u9762\u4e0e\u591a\u89d2\u8272\u7a97\u53e3\u5171\u7528\uff1b\u5267\u60c5\u548c\u6218\u6597\u64ad\u653e\u65f6\u4ecd\u4fdd\u7559\u753b\u9762\u3002')]),vnode('input',{type:'checkbox',role:'switch',class:'amv-settings-switch','aria-label':'\u9690\u85cf\u5de6\u4fa7\u7a7a\u95f2\u9ed1\u5c4f','data-amv-hide-idle':'',checked:preferences.hideIdleCanvas,onChange:event=>{preferences={hideIdleCanvas:event.target.checked};try{localStorage.setItem(KEY,JSON.stringify(preferences));state.message='\u5df2\u4fdd\u5b58\uff0c\u6240\u6709\u6e38\u620f\u7a97\u53e3\u7acb\u5373\u751f\u6548\u3002';}catch{state.message='\u5f53\u524d\u6d4f\u89c8\u5668\u4e0d\u5141\u8bb8\u4fdd\u5b58\uff0c\u4ec5\u672c\u9875\u751f\u6548\u3002';}apply();}},null)]),
        vnode('div',{class:'amv-settings-tools'},[text('button','\u7f6e\u9876\u4e91\u540c\u6b65',{type:'button','data-amv-pin-open':'',onClick:()=>dispatch('aether-pins-settings')}),text('button','\u68c0\u67e5\u66f4\u65b0',{type:'button','data-amv-check-update':'',id:'aether-nav-update',title:'\u68c0\u67e5 AetherOS \u66f4\u65b0\uff08v'+SCRIPT_VERSION+'\uff09',onClick:()=>dispatch('aether-userscript-check-updates')})]),vnode('footer',null,[text('small','AetherOS v'+SCRIPT_VERSION),text('p',state.message,{role:'status'})])]);}
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
    let launch=null;function mount(){const header=document.querySelector('.aether-console .console-header');launch=launch||document.getElementById('aether-multiview-launch');if(!header||!launch)return;const host=header.querySelector(':scope>.header-actions')||header;decorate(launch,'\u591a\u89d2\u8272\u540c\u5c4f','desktop');if(launch.parentElement!==tools)tools.prepend(launch);if(tools.parentElement!==host||host.firstChild!==tools)host.prepend(tools);}
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
    function write(row,before){const normalized=normalizeReinforceRecord(row,true);if(!normalized||JSON.stringify(normalized)===before)return;try{storage.setItem(key(row.character,row.uuid),JSON.stringify(normalized));warning='';try{changed(normalized);}catch{}}catch{warning='\u65e0\u6cd5\u4fdd\u5b58\u5f3a\u5316\u8bb0\u5f55\uff0c\u8bf7\u68c0\u67e5\u6d4f\u89c8\u5668\u5b58\u50a8\u7a7a\u95f4';}}
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
    XMLHttpRequest.prototype.send=function(body){const previous=requests.get(this),request=previous&&describe(previous.url,previous.method,body);if(request){emit({...request,phase:'start'});if(locks.has(request.key)&&request.kind!=='info'&&(request.kind!=='attempt'||request.body.use_voucher!==true)){finish(request,null,true);throw new Error('\u8fde\u7eed\u7528\u5238\u671f\u95f4\u7981\u6b62\u6750\u6599\u5f3a\u5316');}begin(request);let ended=false;const done=error=>{if(ended)return;ended=true;let value;try{value=this.response;}catch{}finish(request,value,error||this.status<200||this.status>=300);};this.addEventListener('load',()=>done(false),{once:true});this.addEventListener('error',()=>done(true),{once:true});this.addEventListener('timeout',()=>done(true),{once:true});this.addEventListener('abort',()=>done(true),{once:true});}return Reflect.apply(send,this,[body]);};
    const fetch=window.fetch;window.fetch=function(input,options){const request=typeof input==='string'||input instanceof URL?describe(String(input),options?.method||'GET',options?.body):null;if(request){emit({...request,phase:'start'});if(locks.has(request.key)&&request.kind!=='info'&&(request.kind!=='attempt'||request.body.use_voucher!==true)){finish(request,null,true);throw new Error('\u8fde\u7eed\u7528\u5238\u671f\u95f4\u7981\u6b62\u6750\u6599\u5f3a\u5316');}begin(request);}let promise;try{promise=Reflect.apply(fetch,this,arguments);}catch(error){if(request)finish(request,null,true);throw error;}if(request)promise.then(response=>response.clone().text().then(value=>finish(request,value,!response.ok),()=>finish(request,null,true)),()=>finish(request,null,true));return promise;};
    function wait(test,timeout=20000){let timer,listener;const promise=new Promise((resolve,reject)=>{listener=event=>{if(test(event)){clearTimeout(timer);listeners.delete(listener);resolve(event);}};listeners.add(listener);timer=setTimeout(()=>{listeners.delete(listener);reject(new Error('\u7b49\u5f85\u5b98\u7f51\u54cd\u5e94\u8d85\u65f6\uff0c\u5df2\u505c\u6b62\uff1b\u8bf7\u68c0\u67e5\u672c\u6b21\u7ed3\u679c'));},timeout);});return {promise,cancel(){clearTimeout(timer);listeners.delete(listener);}};}
    window.addEventListener('storage',event=>{if(event.key===null||event.key?.startsWith('aether-reinforce-history-v1:'))emit({kind:'history',phase:'changed'});});try{window.top.addEventListener('aether-history-sync-status',()=>emit({kind:'history',phase:'changed'}));}catch{}
    return {identity,role,cache,history,remember,bind,lock(key){if(locks.has(key))return false;locks.add(key);return true;},release(key){locks.delete(key);},get sequence(){return sequence;},subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},wait};
  }
  function createReinforceAssistant(instance,panel,bridge,queueSync){
    panel.classList.add('amv-reinforce-assistant');let validation='',disposed=false,state={key:null,native:null,busy:true},run=null;const notes=new Set(),box=element('div',undefined,'amv-voucher-tools'),limit=element('input'),start=button('\u8fde\u7eed\u7528\u5238',begin),hint=element('small'),progress=element('section',undefined,'amv-voucher-progress'),status=element('span'),stop=button('\u505c\u6b62',()=>{if(run){run.cancelled=true;status.textContent='\u5df2\u8bf7\u6c42\u505c\u6b62\uff0c\u5f53\u524d\u8bf7\u6c42\u5b8c\u6210\u540e\u4e0d\u518d\u7ee7\u7eed';stop.disabled=true;}});box.dataset.amvVoucherTools='';start.dataset.amvVoucherStart='';progress.dataset.amvVoucherProgress='';stop.dataset.amvVoucherStop='';box.hidden=true;limit.type='number';limit.min='1';limit.value='1';limit.step='1';limit.setAttribute('aria-label','\u6700\u591a\u4f7f\u7528\u5f3a\u5316\u5238\u6570\u91cf');limit.addEventListener('input',()=>{validation='';queueSync();});const label=element('label','\u6700\u591a\u4f7f\u7528 ');label.append(limit,element('span',' \u5f20\uff0c\u6210\u529f\u5373\u505c'));box.append(label,start,hint);progress.hidden=true;progress.setAttribute('role','status');progress.setAttribute('aria-live','polite');progress.append(status,stop);document.body.append(progress);
    const style=element('style');style.textContent=`.amv-reinforce-history{margin-top:12px;border:1px solid #ffffff18;border-radius:7px;padding:9px 11px;color:#b8c9d5;font-size:.76rem}.amv-reinforce-history[hidden]{display:none!important}.amv-reinforce-history summary{cursor:pointer;color:#a6dacd}.amv-reinforce-history>a{display:inline-block;margin-top:8px;color:#9fd8ca;font-size:.72rem}.amv-reinforce-history>small{display:block;margin-top:8px;color:#91a3b5;font-size:.7rem}.amv-reinforce-history-row{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px 12px;padding-top:8px}.amv-reinforce-history-row>span{min-width:28px;color:#efcb7d}.amv-reinforce-history-row strong{font-weight:500;color:#badfd3}.amv-reinforce-history-row small{color:#91a3b5}.amv-reinforce-history>div>small{display:block;margin-top:8px}.amv-reinforce-assistant .cost-row:has(.amv-reinforce-estimate){display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:baseline;gap:5px 8px}.amv-reinforce-assistant .cost-row>.cost-name{grid-column:2;grid-row:1;min-width:0;white-space:normal;overflow-wrap:break-word}.amv-reinforce-assistant .cost-row>.cost-val{grid-column:3;grid-row:1;white-space:nowrap}.amv-reinforce-assistant .cost-row>.cost-owned{grid-column:4;grid-row:1;white-space:nowrap}.amv-reinforce-assistant .cost-row>.v-icon,.amv-reinforce-assistant .cost-row>i{grid-column:1;grid-row:1}.amv-reinforce-assistant .cost-row>.amv-reinforce-estimate{grid-column:1/-1;margin-left:0;display:flex;flex-wrap:wrap;gap:3px 8px;min-width:0}.amv-reinforce-assistant .amv-reinforce-projection{white-space:normal;overflow-wrap:anywhere}.amv-reinforce-projection{display:inline-block;white-space:nowrap}.amv-reinforce-remaining.is-negative{color:#ff7f88}.amv-reinforce-estimate{margin-left:7px;color:#9fc8bc;font-size:.72rem;white-space:normal}.amv-voucher-tools{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:8px;padding:8px;border:1px solid #ffffff18;border-radius:7px;color:#c6cfda;font-size:.76rem}.amv-voucher-tools[hidden],.amv-voucher-progress[hidden]{display:none!important}.amv-voucher-tools label{display:inline-flex;align-items:center;gap:5px}.amv-voucher-tools input{width:55px;padding:4px 6px;color:inherit;background:#080f1b55;border:1px solid #ffffff20;border-radius:5px;font:inherit}.amv-voucher-tools button,.amv-voucher-progress button{padding:5px 8px;border:1px solid #ffffff20;border-radius:5px;background:#ffffff0a;color:#c6dfd6;font:inherit;cursor:pointer}.amv-voucher-tools small{flex:1 1 100%;color:#9baaba}.amv-voucher-tools button:disabled{opacity:.4;cursor:default}.amv-voucher-progress{position:fixed;right:12px;bottom:64px;z-index:2147483647;max-width:calc(100vw - 24px);box-sizing:border-box;display:flex;align-items:center;gap:12px;padding:12px;border:1px solid #ffffff25;border-radius:10px;background:#242930fa;color:#e7e9ed;box-shadow:0 6px 24px #0005;font:12px/1.5 system-ui}.amv-voucher-running .reinforce-btn,.amv-voucher-running .refresh-btn,.amv-voucher-running .source-toggle,.amv-voucher-running .chip-row-wrapper,.amv-voucher-running .voucher-toggle{opacity:.6}.amv-voucher-tools input:focus-visible,.amv-voucher-tools button:focus-visible,.amv-voucher-progress button:focus-visible{outline:2px solid #87d9c3;outline-offset:2px}`;document.head.append(style);
    function walk(node,visit,seen=new Set()){if(!node||typeof node!=='object'||seen.has(node))return;seen.add(node);visit(node);if(Array.isArray(node.children))node.children.forEach(child=>walk(child,visit,seen));}
    function classes(node){const value=node?.props?.class;return typeof value==='string'?value:Array.isArray(value)?value.filter(part=>typeof part==='string').join(' '):'';}
    function capture(vnode){let mode=null,item=null,native=null;walk(vnode,node=>{const name=classes(node).split(/\s+/);if(name.includes('source-toggle'))mode=node.props?.modelValue;if(name.includes('reinforce-btn'))native=node.props;if(node.type?.__name==='ItemChip'&&node.props?.selected)item=node.props.item;});const body=mode==='backpack'?{source:mode,uuid:item?.uuid}:mode==='equipped'?{source:mode,slot:item?.slot}:null;const key=bridge.identity(body);bridge.bind(key,item);if(key!==state.key)validation='';state={key,item,native:native?.onClick,busy:!!native?.disabled||!!native?.loading};if(run&&run.key!==state.key)run.cancelled=true;}
    function block(event){if(run&&event.target.closest?.('.reinforce-btn,.refresh-btn,.source-toggle,.chip-row-wrapper,.voucher-toggle')){event.preventDefault();event.stopImmediatePropagation();}}
    panel.addEventListener('click',block,true);const unsubscribe=bridge.subscribe(()=>queueSync());
    function current(){return state.key?bridge.cache.get(state.key):null;}
    function checked(){return !!panel.querySelector('.voucher-toggle input')?.checked;}
    function number(value){return Number.isInteger(value)?value.toLocaleString('en-US'):value.toLocaleString('en-US',{maximumFractionDigits:2,minimumFractionDigits:0});}
    function sync(){if(disposed)return;for(const note of notes)if(!note.isConnected)notes.delete(note);const record=current(),info=record?.info,recorded=record&&bridge.remember(state.key,state.item),forecast=reinforceForecast(info),voucher=panel.querySelector('.voucher-toggle'),using=checked();syncHistory(recorded,info);for(const row of panel.querySelectorAll('.cost-card .cost-row')){const value=row.querySelector('.cost-val');if(!value)continue;let note=row.querySelector('.amv-reinforce-estimate');if(!forecast){note?.remove();continue;}const cost=Number(value.textContent.replaceAll(',',''));if(!Number.isFinite(cost)||cost<0)continue;if(!note){note=element('span',undefined,'amv-reinforce-estimate');row.append(note);notes.add(note);}const ownedText=row.querySelector('.cost-owned')?.textContent.trim().replaceAll(',',''),ownedMatch=ownedText?.match(/^[\uff08(]?\s*(-?\d+(?:\.\d+)?)\s*[\uff09)]?$/),owned=ownedMatch?Number(ownedMatch[1]):null,signature=[using,cost,forecast.expected,forecast.maximum,owned].join(':');if(note.dataset.amvEstimateSignature!==signature){note.dataset.amvEstimateSignature=signature;note.replaceChildren();const append=(label,consumption)=>{const group=element('span',undefined,'amv-reinforce-projection');group.append(document.createTextNode(label));note.append(group);const remaining=element('span',undefined,'amv-reinforce-remaining');let value=owned===null?null:owned-consumption;if(value!==null&&Math.abs(value)<1e-9)value=0;remaining.textContent='\uff08\u4f59 '+(value===null?'\u2014':number(value))+'\uff09';remaining.classList.toggle('is-negative',value!==null&&value<0);group.append(remaining);};if(using)append('\u7528\u5238\uff1a\u6750\u6599 0',0);else{append('\u671f\u671b\u2248'+number(cost*forecast.expected),cost*forecast.expected);if(forecast.maximum===null)note.append(document.createTextNode('\u65e0\u6709\u9650\u4fdd\u5e95'));else append('\u81f3\u591a '+number(cost*forecast.maximum),cost*forecast.maximum);}}note.title='\u5230\u4e0b\u4e00\u7ea7\uff0c\u9884\u8ba1 '+number(forecast.expected)+' \u6b21'+(forecast.maximum===null?'\uff0c\u6ca1\u6709\u6709\u9650\u6b21\u6570\u4e0a\u9650':'\uff0c\u6700\u591a '+forecast.maximum+' \u6b21\uff08\u5df2\u8ba1\u5165\u5f53\u524d\u4fdd\u5e95\u8fdb\u5ea6\uff09');}
      if(voucher&&box.previousElementSibling!==voucher)voucher.after(box);const available=info?.voucher_count;box.hidden=!using||!Number.isInteger(available)||available<1||!forecast||typeof state.native!=='function';limit.max=String(available||1);limit.disabled=!!run;start.disabled=!!run||state.busy;const text=validation||(forecast?'\u9884\u8ba1\u2248'+number(forecast.expected)+' \u5f20'+(forecast.maximum===null?'':'\uff0c\u6700\u591a '+forecast.maximum+' \u5f20')+'\uff1b\u5238\u4e0d\u8db3\u6216\u51fa\u9519\u4f1a\u505c\u6b62\uff0c\u4e0d\u6539\u7528\u6750\u6599\u3002':'');if(hint.textContent!==text)hint.textContent=text;if(run&&(state.key!==run.key||!panel.isConnected||instance.isUnmounted))run.cancelled=true;
    }
    const historyBox=element('details',undefined,'amv-reinforce-history'),historyTitle=element('summary'),historyRows=element('div'),historyNote=element('small'),historyLink=element('a','\u67e5\u770b Web \u5f3a\u5316\u5386\u53f2');historyLink.target='_blank';historyLink.rel='noopener noreferrer';historyLink.referrerPolicy='no-referrer';historyLink.hidden=true;let historySignature='';historyBox.dataset.amvReinforceHistory='';historyBox.hidden=true;historyBox.append(historyTitle,historyRows,historyNote,historyLink);
    function syncHistory(record,info){const target=panel.querySelector('.detail-panel');if(target&&!target.contains(historyBox))target.append(historyBox);historyBox.hidden=!record;if(!record)return;let cloud;try{cloud=window.top[Symbol.for('aether.history.sync.status')];}catch{}historyLink.hidden=!cloud?.server;if(cloud?.server)historyLink.href=cloud.server+'/admin/aether?character_view=history#aether-equipment';const signature=JSON.stringify([record,info?.next?.fails,bridge.history.warning,cloud]);if(signature===historySignature)return;historySignature=signature;const current=record.levels[(info?.equipment?.reinforce_level??0)+1],fails=current?.fails??info?.next?.fails;historyTitle.textContent='\u5f3a\u5316\u8bb0\u5f55'+(current?.complete?' \u00b7 +'+(info.equipment.reinforce_level+1)+(current.attempts===null?' \u5df2\u6210\u529f\uff0c\u6b21\u6570\u672a\u8bb0\u5f55':' \u7b2c '+current.attempts+' \u6b21\u6210\u529f'):Number.isSafeInteger(fails)?' \u00b7 \u5df2\u5931\u8d25 '+fails+' \u6b21\uff0c\u4e0b\u6b21\u7b2c '+(fails+1)+' \u6b21':'');historyRows.replaceChildren();const rows=Object.entries(record.levels).filter(([level,row])=>row.complete).sort((a,b)=>Number(b[0])-Number(a[0]));for(const [level,row]of rows){const line=element('div',undefined,'amv-reinforce-history-row'),label=element('span','+'+level),result=element('strong',row.conflict?'\u6210\u529f\u6b21\u6570\u5b58\u5728\u51b2\u7a81':row.attempts===null?'\u6210\u529f\u6b21\u6570\u672a\u8bb0\u5f55':'\u7b2c '+row.attempts+' \u6b21\u6210\u529f'),method=element('small','\u5df2\u8bb0\u5f55\uff1a\u6750\u6599 '+(row.material||0)+' \u6b21 \u00b7 \u7528\u5238 '+(row.voucher||0)+' \u6b21');if(row.success_at){result.title=new Date(row.success_at).toLocaleString();method.textContent+=' \u00b7 '+new Date(row.success_at).toLocaleString(undefined,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}line.append(label,result,method);historyRows.append(line);}if(!rows.length)historyRows.append(element('small','\u6682\u65e0\u5df2\u8bb0\u5f55\u7684\u6210\u529f\u5f3a\u5316'));const attempts=Object.values(record.events||{}).sort((a,b)=>b.started_at-a.started_at);if(attempts.length){historyRows.append(element('small','\u6700\u8fd1\u9010\u6b21\u8bb0\u5f55\uff08\u5168\u90e8\u89c1 Web\uff09'));for(const entry of attempts.slice(0,10)){const line=element('div',undefined,'amv-reinforce-history-row'),state=entry.conflict?'\u7ed3\u679c\u51b2\u7a81':({success:'\u6210\u529f',failure:'\u5931\u8d25',unknown:'\u5f85\u6838\u5b9e',pending:'\u7b49\u5f85\u7ed3\u679c',rejected:'\u8bf7\u6c42\u88ab\u62d2\u7edd'}[entry.status]||'\u5f85\u6838\u5b9e');line.append(element('span','+'+entry.target),element('strong',state),element('small',new Date(entry.started_at).toLocaleString(undefined,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})+' \u00b7 '+(entry.source==='daily'?'\u6bcf\u65e5\u81ea\u52a8':'\u624b\u52a8')+' \u00b7 '+(entry.method==='voucher'?'\u7528\u5238':'\u6750\u6599')+(entry.count>1?' \u00d7'+entry.count:'')));historyRows.append(line);}}historyNote.textContent=bridge.history.warning||(current?.pending?'\u672c\u6b21\u7ed3\u679c\u5f85\u6838\u5b9e\uff0c\u91cd\u65b0\u9009\u62e9\u88c5\u5907\u53ef\u8bfb\u53d6\u670d\u52a1\u5668\u5f53\u524d\u8fdb\u5ea6\u3002':cloud?.message||'\u5f3a\u5316\u8bb0\u5f55\u4ec5\u5b58\u672c\u673a\uff0c\u8fde\u63a5\u7f6e\u9876\u4e91\u540c\u6b65\u540e\u81ea\u52a8\u540c\u6b65');}
    function bounded(promise,ms=20000){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('\u7b49\u5f85\u5b98\u7f51\u5237\u65b0\u8d85\u65f6\uff0c\u5df2\u505c\u6b62\uff1b\u8bf7\u68c0\u67e5\u672c\u6b21\u7ed3\u679c')),ms);})]).finally(()=>clearTimeout(timer));}
    async function begin(){if(run||disposed)return;const record=current(),info=record?.info,n=Number(limit.value);if(!record||!reinforceForecast(info)||!Number.isInteger(n)||n<1||n>info.voucher_count||!checked()||state.busy||typeof state.native!=='function'){validation='\u8bf7\u8f93\u5165\u4e0d\u8d85\u8fc7\u5f53\u524d\u5f3a\u5316\u5238\u6570\u91cf\u7684\u6b63\u6574\u6570';hint.textContent=validation;return;}validation='';const active={key:state.key,level:info.equipment?.reinforce_level,limit:n,used:0,cancelled:false,lastStart:0,character:bridge.role()};if(!Number.isInteger(active.level)||!bridge.lock(active.key))return;run=active;panel.classList.add('amv-voucher-running');progress.hidden=false;stop.disabled=false;stop.textContent='\u505c\u6b62';sync();let message='';try{while(active.used<active.limit&&!active.cancelled){if(disposed||!panel.isConnected||instance.isUnmounted||bridge.role()!==active.character||state.key!==active.key||!checked()||state.busy)break;const latest=current();if(!latest||latest.info.voucher_count<1||latest.info.equipment?.reinforce_level!==active.level)break;const delay=500-(performance.now()-active.lastStart);if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));if(active.cancelled||disposed||!panel.isConnected||panel.closest('[inert]')||bridge.role()!==active.character||state.key!==active.key||!checked()||state.busy||current()?.info.voucher_count<1||current()?.info.equipment?.reinforce_level!==active.level)break;active.lastStart=performance.now();status.textContent='\u8fde\u7eed\u7528\u5238 '+active.used+' / '+active.limit+'\uff0c\u6b63\u5728\u7b49\u5f85\u672c\u6b21\u7ed3\u679c';const after=bridge.sequence,wait=bridge.wait(event=>event.phase==='done'&&['attempt','attempt_continuous'].includes(event.kind)&&event.key===active.key&&event.id>after);let response;try{const native=Promise.resolve(state.native());native.catch(()=>{});response=await wait.promise;await bounded(native);}finally{wait.cancel();}if(response.kind!=='attempt'||response.body.use_voucher!==true||response.error||response.data?.code!==0||typeof response.data.data?.success!=='boolean')throw new Error('\u672c\u6b21\u5f3a\u5316\u672a\u786e\u8ba4\uff0c\u5df2\u505c\u6b62\uff1b\u8bf7\u5237\u65b0\u68c0\u67e5\uff0c\u52ff\u91cd\u590d\u63d0\u4ea4');active.used++;const result=response.data.data;if(result.success||result.new_level>active.level){message='\u5f3a\u5316\u6210\u529f\uff0c\u5df2\u6267\u884c '+active.used+' \u6b21\u7528\u5238\u5f3a\u5316';break;}if(result.new_level!==active.level)throw new Error('\u88c5\u5907\u7b49\u7ea7\u53d1\u751f\u53d8\u5316\uff0c\u5df2\u505c\u6b62');if(reinforceForecast(latest.info)?.maximum===1)throw new Error('\u9884\u671f\u4fdd\u5e95\u6216\u5fc5\u5b9a\u6210\u529f\u5374\u672a\u6210\u529f\uff0c\u5df2\u505c\u6b62\uff0c\u8bf7\u68c0\u67e5\u7ed3\u679c');if(active.cancelled||active.used>=active.limit)break;const fresh=current();if(!fresh||fresh.id<=response.id){const update=bridge.wait(event=>event.phase==='done'&&event.kind==='info'&&event.key===active.key&&event.id>response.id);try{const received=await update.promise;if(received.error||received.data?.code!==0||!current()||current().id<=response.id)throw new Error('\u5f3a\u5316\u4fe1\u606f\u672a\u5237\u65b0\uff0c\u5df2\u505c\u6b62\uff1b\u8bf7\u68c0\u67e5\u672c\u6b21\u7ed3\u679c');}finally{update.cancel();}}await new Promise(resolve=>setTimeout(resolve,0));sync();}
        if(!message)message=active.cancelled?'\u5df2\u505c\u6b62\uff0c\u5df2\u6267\u884c '+active.used+' \u6b21\u7528\u5238\u5f3a\u5316':'\u672c\u8f6e\u7ed3\u675f\uff0c\u5df2\u6267\u884c '+active.used+' \u6b21\u7528\u5238\u5f3a\u5316';
      }catch(error){message=error.message||'\u8fde\u7eed\u7528\u5238\u5df2\u505c\u6b62\uff0c\u8bf7\u68c0\u67e5\u672c\u6b21\u7ed3\u679c';}finally{bridge.release(active.key);if(run===active)run=null;panel.classList.remove('amv-voucher-running');status.textContent=message;stop.disabled=false;stop.textContent='\u5173\u95ed';stop.onclick=()=>{if(!run)progress.hidden=true;};sync();}}
    function dispose(){disposed=true;if(run)run.cancelled=true;unsubscribe();panel.removeEventListener('click',block,true);box.remove();historyBox.remove();progress.remove();style.remove();notes.forEach(node=>node.remove());panel.classList.remove('amv-voucher-running','amv-reinforce-assistant');}
    return {capture,sync,dispose};
  }
  function initReinforceFilters(){
    const guard=Symbol.for('aether.reinforce.filters');if(window[guard])return;window[guard]=true;
    const root=document.getElementById('app');if(!root)return;const bridge=createReinforceBridge(),controllers=new Set(),PAGE_SIZE=30,elements={fire:['\u706b','mdi-fire','#ff7a5c'],water:['\u6c34','mdi-water','#62d1ff'],lightning:['\u96f7','mdi-lightning-bolt','#ffd451'],earth:['\u5730','mdi-terrain','#9bd36e'],wind:['\u98ce','mdi-weather-windy','#6eeedc'],light:['\u5149','mdi-white-balance-sunny','#f9ffb5'],dark:['\u6697','mdi-moon-waning-crescent','#a98bff'],none:['\u672a\u6807\u6ce8','mdi-circle-outline','#a3acbb']},rarities={1:'#9ea3b0',2:'#6ddc8e',3:'#5db8ff',4:'#c47aff',5:'#ffc84a',6:'#ff5b5b'};
    const style=element('style');style.textContent=`
      .amv-reinforce-tools,.amv-reinforce-pages{font:inherit;color:inherit;flex-shrink:0;min-width:0}.amv-reinforce-tools [hidden],.amv-reinforce-tools[hidden],.amv-reinforce-pages[hidden]{display:none!important}.amv-reinforce-tools{display:flex;flex-direction:column;gap:6px}.amv-reinforce-tools input{width:100%;box-sizing:border-box;margin:0;padding:6px 8px;border:1px solid #ffffff18;border-radius:6px;background:#080f1b55;color:inherit;font:inherit;font-size:.76rem}.amv-reinforce-chips{display:flex;flex-wrap:wrap;gap:4px}.amv-reinforce-tools button,.amv-reinforce-pages button{display:inline-flex;align-items:center;justify-content:center;gap:3px;margin:0;padding:3px 6px;border:1px solid #ffffff12;border-radius:5px;background:#ffffff04;color:var(--amv-chip,#aab7c7);font:inherit;font-size:.7rem;line-height:1.5;cursor:pointer}.amv-reinforce-tools button[aria-pressed=true]{border-color:var(--amv-chip,#87d9c3);background:#ffffff0d}.amv-reinforce-tools button:hover,.amv-reinforce-pages button:hover{background:#ffffff0d}.amv-reinforce-tools input:focus-visible,.amv-reinforce-tools button:focus-visible,.amv-reinforce-pages button:focus-visible{outline:2px solid #87d9c3;outline-offset:2px}.amv-reinforce-pages{display:flex;align-items:center;justify-content:space-between;gap:5px;font-size:.7rem;color:#9daec1}.amv-reinforce-pages button:disabled{opacity:.35;cursor:default}.amv-reinforce-count{margin:0;font-size:.7rem;color:#9daec1}.amv-reinforce-enabled .item-selector{min-width:0}.amv-reinforce-enabled .item-list{min-height:70px}@media(max-width:768px){.amv-reinforce-enabled .item-selector{height:360px;min-height:360px}}
    `;document.head.append(style);
    function walk(vnode,visit,components=false,seen=new Set()){if(!vnode||typeof vnode!=='object'||seen.has(vnode))return;seen.add(vnode);visit(vnode);if(components&&vnode.component)walk(vnode.component.subTree,visit,components,seen);if(Array.isArray(vnode.children))vnode.children.forEach(child=>walk(child,visit,components,seen));if(vnode.suspense)walk(vnode.suspense.activeBranch,visit,components,seen);}
    function hasClass(vnode,name){const value=vnode?.props?.class;return typeof value==='string'?value.split(/\s+/).includes(name):Array.isArray(value)?value.some(part=>typeof part==='string'?part.split(/\s+/).includes(name):part&&typeof part==='object'&&part[name]):!!value&&typeof value==='object'&&!!value[name];}
    function related(item){const found=new Set(),add=key=>{if(Object.hasOwn(elements,key)&&key!=='none')found.add(key);};add(item.element);for(const [key,value]of Object.entries(item.element_coeffs||{}))if(Number.isFinite(value)&&value>1)add(key);for(const map of [item.element_coeff_levels,item.affinity_bonus])for(const [key,value]of Object.entries(map||{}))if(Number.isFinite(value)&&value>0)add(key);for(const map of [item.base_stats,item.override_stats,item.effective_stats])for(const [key,value]of Object.entries(map||{}))if(key.startsWith('amplify_')&&Number.isFinite(value)&&value>0)add(key.slice(8));return found;}
    function attach(instance,panel){
      if(typeof instance.render!=='function')return;const original=instance.render,selector=panel.querySelector('.reinforce-layout .item-selector');if(!selector)return;const assistant=createReinforceAssistant(instance,panel,bridge,queueSync);let character='';try{character=sessionStorage.getItem(ACTIVE)||'current';}catch{character='current';}const pinKey='aether-bag-pins-v1:'+character;function readPins(){try{const value=JSON.parse(localStorage.getItem(pinKey)||'[]');return new Set(Array.isArray(value)?value.filter(uuid=>typeof uuid==='string'):[]);}catch{return new Set();}}let pins=readPins();
      const tools=element('div',undefined,'amv-reinforce-tools'),search=element('input'),stars=element('div',undefined,'amv-reinforce-chips'),elementRow=element('div',undefined,'amv-reinforce-chips'),slotRow=element('div',undefined,'amv-reinforce-chips'),count=element('p',undefined,'amv-reinforce-count'),pages=element('div',undefined,'amv-reinforce-pages'),pageLabel=element('span'),previous=button('\u4e0a\u4e00\u9875',()=>changePage(-1)),next=button('\u4e0b\u4e00\u9875',()=>changePage(1)),clear=button('\u6e05\u7a7a',reset);tools.dataset.amvReinforceFilter='';pages.dataset.amvReinforcePages='';search.type='search';search.placeholder='\u641c\u7d22\u5f3a\u5316\u88c5\u5907\u540d\u79f0\u2026';search.setAttribute('aria-label','\u641c\u7d22\u5f3a\u5316\u88c5\u5907');previous.dataset.amvReinforcePrev='';next.dataset.amvReinforceNext='';tools.append(search,slotRow,stars,elementRow,count);pages.append(previous,pageLabel,next);
      let page=0,query='',timer=null,disposed=false,snapshot={mode:'backpack',total:0,matched:0,pages:1,stars:[],ready:false},signature='';const selectedStars=new Set(),selectedElements=new Set(),selectedSlots=new Set();
      for(const [key,[label,icon,color]]of Object.entries(elements)){const choice=button(undefined,()=>toggle(selectedElements,key));choice.dataset.amvReinforceElement=key;choice.style.setProperty('--amv-chip',color);const glyph=element('i',undefined,'mdi '+icon);glyph.setAttribute('aria-hidden','true');choice.append(glyph,element('span',label));choice.setAttribute('aria-label',label);elementRow.append(choice);}clear.dataset.amvReinforceClear='';elementRow.append(clear);
      slotRow.append(element('span','\u90e8\u4f4d'));for(const [key,[label,icon]]of Object.entries(GEAR_SLOTS)){const choice=button('',()=>toggle(selectedSlots,key)),glyph=element('i',undefined,'mdi '+icon);glyph.setAttribute('aria-hidden','true');choice.append(glyph,element('span',label));choice.dataset.amvReinforceSlot=key;choice.setAttribute('aria-label',label+'\u90e8\u4f4d');slotRow.append(choice);}
      function refresh(){if(!disposed&&!instance.isUnmounted)instance.proxy?.$forceUpdate();}
      function toggle(set,value){set.has(value)?set.delete(value):set.add(value);page=0;refresh();}
      function changePage(step){page=Math.max(0,Math.min(snapshot.pages-1,page+step));selector.querySelector('.item-list')?.scrollTo(0,0);refresh();}
      function reset(){clearTimeout(timer);query='';search.value='';selectedStars.clear();selectedElements.clear();selectedSlots.clear();page=0;refresh();}
      search.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{query=search.value.trim().toLocaleLowerCase();page=0;refresh();},120);});
      function render(...args){const vnode=original.apply(this,args);assistant.capture(vnode);let fragment=null,all=null;try{
        let mode=null,list=null;walk(vnode,node=>{if(hasClass(node,'source-toggle')&&['backpack','equipped'].includes(node.props?.modelValue))mode=node.props.modelValue;if(hasClass(node,'item-list'))list=node;});
        if(mode!=='backpack'){snapshot={...snapshot,mode,ready:false};queueSync();return vnode;}
        fragment=list?.children?.find(node=>Array.isArray(node?.children)&&node.patchFlag===128);all=fragment?.children;if(!Array.isArray(all)||fragment.dynamicChildren?.length){snapshot={...snapshot,mode,ready:false};queueSync();return vnode;}
        const rows=all.map(row=>{const chip=Array.isArray(row.children)&&row.children.find(child=>child?.type?.__name==='ItemChip');if(!hasClass(row,'chip-row-wrapper')||typeof row.key!=='string'||!row.key.startsWith('bp-')||!chip?.props?.item)throw new Error('\u5b98\u7f51\u88c5\u5907\u5217\u8868\u7ed3\u6784\u5df2\u53d8\u66f4');return {row,item:chip.props.item};});
        const matched=rows.filter(({item})=>{const star=Number.isFinite(item.rarity)?item.rarity:0;if(query&&!String(item.name||'').toLocaleLowerCase().includes(query)||selectedStars.size&&!selectedStars.has(star))return false;if(selectedSlots.size&&!selectedSlots.has(equipmentSlot(item)))return false;if(!selectedElements.size)return true;const values=related(item);return [...selectedElements].some(value=>value==='none'?values.size===0:values.has(value));}).sort((a,b)=>Number(pins.has(b.item.uuid))-Number(pins.has(a.item.uuid)));
        const totalPages=Math.max(1,Math.ceil(matched.length/PAGE_SIZE));page=Math.max(0,Math.min(page,totalPages-1));snapshot={mode,total:rows.length,matched:matched.length,pages:totalPages,stars:[...new Set(rows.map(({item})=>Number.isFinite(item.rarity)?item.rarity:0))].sort((a,b)=>a-b),ready:true,unknownSlot:rows.some(({item})=>equipmentSlot(item)==='none')};
        // 只裁剪本次渲染的行，保留官网原始物品、选中状态、点击回调和强化请求。
        fragment.children=matched.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map(({row})=>row);queueSync();return vnode;
      }catch{if(fragment&&all)fragment.children=all;snapshot={...snapshot,ready:false};queueSync();return vnode;}}
      function sync(){if(disposed||!panel.isConnected)return;assistant.sync();const list=selector.querySelector('.item-list');if(list){if(tools.nextElementSibling!==list)list.before(tools);if(pages.previousElementSibling!==list)list.after(pages);}else{if(!selector.contains(tools))selector.append(tools);if(!selector.contains(pages))selector.append(pages);}tools.hidden=pages.hidden=!snapshot.ready||snapshot.mode!=='backpack';panel.classList.toggle('amv-reinforce-enabled',snapshot.ready&&snapshot.mode==='backpack');if(tools.hidden)return;
        const value=snapshot.stars.join(',');if(signature!==value){signature=value;stars.replaceChildren();for(const star of snapshot.stars){const choice=button(star>0?star+'\u2605':'\u672a\u6807\u661f',()=>toggle(selectedStars,star));choice.dataset.amvReinforceStar=star;choice.style.setProperty('--amv-chip',rarities[star]||'#9ea3b0');stars.append(choice);}}for(const choice of stars.children)choice.setAttribute('aria-pressed',String(selectedStars.has(Number(choice.dataset.amvReinforceStar))));for(const choice of slotRow.querySelectorAll('[data-amv-reinforce-slot]')){choice.setAttribute('aria-pressed',String(selectedSlots.has(choice.dataset.amvReinforceSlot)));choice.hidden=choice.dataset.amvReinforceSlot==='none'&&!snapshot.unknownSlot;}for(const choice of elementRow.querySelectorAll('[data-amv-reinforce-element]'))choice.setAttribute('aria-pressed',String(selectedElements.has(choice.dataset.amvReinforceElement)));const text=snapshot.matched?'\u7b26\u5408 '+snapshot.matched+' / '+snapshot.total+' \u4ef6':'\u6ca1\u6709\u7b26\u5408\u6761\u4ef6\u7684\u88c5\u5907';if(count.textContent!==text)count.textContent=text;const label=(page+1)+' / '+snapshot.pages;if(pageLabel.textContent!==label)pageLabel.textContent=label;previous.disabled=page===0;next.disabled=page>=snapshot.pages-1;
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
    const elements={fire:['\u706b','mdi-fire','#ff7a5c'],water:['\u6c34','mdi-water','#62d1ff'],lightning:['\u96f7','mdi-lightning-bolt','#ffd451'],earth:['\u5730','mdi-terrain','#9bd36e'],wind:['\u98ce','mdi-weather-windy','#6eeedc'],light:['\u5149','mdi-white-balance-sunny','#f9ffb5'],dark:['\u6697','mdi-moon-waning-crescent','#a98bff'],none:['\u672a\u6807\u6ce8','mdi-circle-outline','#a3acbb']},rarityColors={1:'#9ea3b0',2:'#6ddc8e',3:'#5db8ff',4:'#c47aff',5:'#ffc84a',6:'#ff5b5b'},controllers=new Set(),revision='__aetherBagFilterRevision';
    const style=element('style');style.id='aether-backpack-filter-style';style.textContent=`
      .bag-card .bag-tabs.amv-bag-tabs{flex-wrap:wrap}.amv-bag-filter{flex:0 0 100%;min-width:0;display:flex;flex-direction:column;gap:7px;margin-top:4px;font:inherit;color:inherit}.amv-bag-filter[hidden],.amv-bag-filter [hidden]{display:none!important}.amv-bag-filter *{box-sizing:border-box}.amv-bag-filter button,.amv-bag-filter input{margin:0;font:inherit}.amv-bag-filter button{cursor:pointer;border:1px solid #ffffff0d;border-radius:6px;padding:3px 7px;background:#ffffff04;color:#aab7c7;line-height:1.5;font-size:.73rem}.amv-bag-filter button:hover{background:#ffffff0b}.amv-bag-filter button[aria-pressed=true]{color:var(--amv-chip,#87d9c3);border-color:var(--amv-chip,#87d9c3);background:#ffffff09}.amv-bag-filter button:focus-visible,.amv-bag-filter input:focus-visible,.amv-bag-pin:focus-visible{outline:2px solid #87d9c3;outline-offset:2px}.amv-bag-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.amv-bag-head input{flex:1 1 130px;min-width:90px;padding:5px 8px;background:#080f1b55;border:1px solid #ffffff12;border-radius:6px;color:inherit;font-size:.76rem}.amv-bag-count{color:#94a7b7;font-size:.69rem;white-space:nowrap}.amv-bag-details{display:flex;flex-direction:column;gap:6px}.amv-bag-row{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.amv-bag-row>span{min-width:30px;font-size:.72rem;color:#8ea0b3}.amv-bag-row button{color:var(--amv-chip,#aab7c7);display:inline-flex;align-items:center;gap:3px}.amv-bag-row i{font-size:.8rem}.amv-bag-notice{margin:0;color:#d7ba78;font-size:.7rem}.amv-bag-pin{position:absolute;right:-5px;bottom:-5px;z-index:8;display:grid;place-items:center;width:20px;height:20px;padding:0!important;margin:0!important;border:1px solid #ffffff19;border-radius:6px;background:#172434;color:#8f9eb0;font-size:12px;line-height:1;opacity:0;cursor:pointer}.bag-grid-item:hover>.amv-bag-pin,.bag-grid-item:focus-within>.amv-bag-pin,.amv-bag-pin[aria-pressed=true],.amv-bag-pin-mode .amv-bag-pin{opacity:1}.amv-bag-pin svg{width:14px;height:14px;pointer-events:none}.amv-bag-pin[aria-pressed=true] [data-pin-head]{fill:currentColor}.amv-bag-pin[aria-pressed=true]{color:#f4cd79;background:#30312c}.amv-bag-pin-mode .bag-grid-item:has(>.amv-bag-pin){outline:1px solid #ffffff12;cursor:pointer}.amv-bag-selling .amv-bag-pin{display:none!important}.amv-bag-filter[inert]{opacity:.6}@media(pointer:coarse){.amv-bag-pin{opacity:1}}
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
      const tabs=bag.querySelector('.bag-tabs');if(!tabs)return;const bar=element('section',undefined,'amv-bag-filter'),head=element('div',undefined,'amv-bag-head'),search=element('input'),count=element('span',undefined,'amv-bag-count'),details=element('div',undefined,'amv-bag-details'),notice=element('p',undefined,'amv-bag-notice'),kindRow=element('div',undefined,'amv-bag-row'),starRow=element('div',undefined,'amv-bag-row'),elementRow=element('div',undefined,'amv-bag-row'),slotRow=element('div',undefined,'amv-bag-row');bar.dataset.amvBagFilter='';search.type='search';search.setAttribute('aria-label','\u641c\u7d22\u80cc\u5305\u7269\u54c1');search.placeholder='\u641c\u7d22\u88c5\u5907\u540d\u79f0\u2026';notice.hidden=true;let queryTimer=null,lastStars='',currentKind='';
      function persist(){try{localStorage.setItem(viewKey,JSON.stringify({expanded:state.expanded,...Object.fromEntries(Object.entries(views).map(([kind,value])=>[kind,{q:value.q,stars:[...value.stars],elements:[...value.elements],slots:[...value.slots],type:value.type}]))}));}catch{}}
      function filtered(kind){const full=sources.get(kind==='equipment'?'backpackEquipment':'backpackConsumables');void props[revision];if(!state.enabled||!full)return full;try{const value=views[kind],skills=skillMap(),query=value.q.trim().toLocaleLowerCase(),active=query||value.stars.size||value.elements.size||kind==='equipment'&&value.slots.size||kind==='consumables'&&value.type!=='all';if(!active&&(kind!=='equipment'||!pins.size))return full;let rows=full.filter(item=>{if(!item||typeof item!=='object')return false;if(query&&!String(item.name||'').toLocaleLowerCase().includes(query))return false;if(value.stars.size&&!value.stars.has(Number.isFinite(item.rarity)?item.rarity:0))return false;if(kind==='equipment'&&value.slots.size&&!value.slots.has(equipmentSlot(item)))return false;if(kind==='consumables'&&value.type!=='all'&&category(item)!==value.type)return false;if(value.elements.size){const set=related(item,kind,skills);if(![...value.elements].some(key=>key==='none'?!set.size:set.has(key)))return false;}return true;});if(kind==='equipment'&&pins.size)rows=[...rows.filter(item=>pins.has(item.uuid)),...rows.filter(item=>!pins.has(item.uuid))];return rows;}catch{state.failed=true;return full;}}
      function resetPages(){walk(instance.subTree,vnode=>{if((vnode.type?.name||vnode.type?.__name)==='VPagination'&&vnode.props?.modelValue!==1){const update=vnode.props?.['onUpdate:modelValue'];if(typeof update==='function')update(1);else if(Array.isArray(update))update.forEach(fn=>typeof fn==='function'&&fn(1));}});}
      function changed(reset=true){if(reset)resetPages();props[revision]++;persist();sync();}
      function togglePin(uuid){if(state.selling)return;if(pins.has(uuid))pins.delete(uuid);else pins.add(uuid);try{localStorage.setItem(pinKey,JSON.stringify([...pins]));}catch{}notifyPinChange(who,uuid,pins.has(uuid));changed();}
      const expand=button('\u7b5b\u9009',()=>{state.expanded=!state.expanded;persist();sync();}),pinMode=button('\u7ba1\u7406\u7f6e\u9876',()=>{state.pinMode=!state.pinMode;sync();}),clear=button('\u6e05\u7a7a',()=>{const value=views[state.kind];value.q='';value.stars.clear();value.elements.clear();value.slots.clear();value.type='all';search.value='';changed();});expand.dataset.amvBagExpand='';pinMode.dataset.amvBagPinMode='';clear.dataset.amvBagClear='';head.append(search,expand,pinMode,clear,count);kindRow.append(element('span','\u5206\u7c7b'));for(const [key,label]of [['all','\u5168\u90e8'],['skill','\u6280\u80fd\u4e66'],['prism','\u5149\u8c31'],['other','\u5176\u4ed6']]){const choice=button(label,()=>{views.consumables.type=key;changed();});choice.dataset.amvBagType=key;kindRow.append(choice);}starRow.append(element('span','\u661f\u7ea7'));elementRow.append(element('span','\u5143\u7d20'));for(const [key,[label,icon,color]]of Object.entries(elements)){const choice=button('',()=>{const set=views[state.kind].elements;set.has(key)?set.delete(key):set.add(key);changed();}),glyph=element('i',undefined,'mdi '+icon);glyph.setAttribute('aria-hidden','true');choice.append(glyph,element('span',label));choice.dataset.amvBagElement=key;choice.style.setProperty('--amv-chip',color);choice.setAttribute('aria-label',label+'\u5143\u7d20');elementRow.append(choice);}elementRow.title='\u88c5\u5907\u6309\u5143\u7d20\u4fee\u6b63\u3001\u5143\u7d20\u5f3a\u5316\u548c\u4eb2\u548c\u52a0\u6210\u7b5b\u9009\uff1b\u6d88\u8017\u54c1\u6309\u5143\u7d20\u3001\u6280\u80fd\u5c5e\u6027\u548c\u4eb2\u548c\u9700\u6c42\u7b5b\u9009\uff0c\u517c\u5bb9\u5b98\u7f51\u9700\u6c42\u5217\u8868\uff1b\u672a\u6807\u6ce8\u4e0d\u4f1a\u6309\u540d\u79f0\u731c\u6d4b\u3002';slotRow.append(element('span','\u90e8\u4f4d'));for(const [key,[label,icon]]of Object.entries(GEAR_SLOTS)){const choice=button('',()=>{const set=views.equipment.slots;set.has(key)?set.delete(key):set.add(key);changed();}),glyph=element('i',undefined,'mdi '+icon);glyph.setAttribute('aria-hidden','true');choice.append(glyph,element('span',label));choice.dataset.amvBagSlot=key;choice.setAttribute('aria-label',label+'\u90e8\u4f4d');slotRow.append(choice);}details.append(kindRow,slotRow,starRow,elementRow);bar.append(head,details,notice);tabs.classList.add('amv-bag-tabs');tabs.append(bar);
      search.addEventListener('input',()=>{clearTimeout(queryTimer);const kind=state.kind,value=search.value.slice(0,200);queryTimer=setTimeout(()=>{views[kind].q=value;changed();},120);});
      function selectCard(event){if(!state.pinMode||state.selling||state.kind!=='equipment')return;const cell=event.target.closest('.bag-grid-item[data-amv-bag-uuid]');if(!cell||!bag.contains(cell))return;event.preventDefault();event.stopImmediatePropagation();togglePin(cell.dataset.amvBagUuid);}
      bag.addEventListener('click',selectCard,true);
      function cells(){const full=sources.get('backpackEquipment'),ids=new Map(full.filter(item=>typeof item?.uuid==='string').map(item=>[item.uuid,item]));walk(instance.subTree,vnode=>{if(typeof vnode.key!=='string'||!ids.has(vnode.key))return;let cell=null;walk(vnode,node=>{if(!cell&&node.el?.nodeType===1&&node.el.classList.contains('bag-grid-item')&&bag.contains(node.el))cell=node.el;});if(!cell)return;const item=ids.get(vnode.key);cell.dataset.amvBagUuid=item.uuid;let pin=cell.querySelector(':scope > .amv-bag-pin');if(!pin){pin=button('',event=>{event.preventDefault();event.stopImmediatePropagation();togglePin(cell.dataset.amvBagUuid);});pin.className='amv-bag-pin';const ns='http://www.w3.org/2000/svg',icon=document.createElementNS(ns,'svg'),head=document.createElementNS(ns,'path'),stem=document.createElementNS(ns,'path');icon.setAttribute('viewBox','0 0 20 20');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','1.4');icon.setAttribute('stroke-linecap','round');icon.setAttribute('stroke-linejoin','round');icon.setAttribute('aria-hidden','true');head.setAttribute('d','M7 3h6l-1 5 3 4v2H5v-2l3-4Z');head.setAttribute('data-pin-head','');stem.setAttribute('d','M10 14v4');icon.append(head,stem);pin.append(icon);for(const type of ['pointerdown','mousedown','touchstart','touchend','contextmenu','dblclick'])pin.addEventListener(type,event=>event.stopPropagation());cell.append(pin);}const chosen=pins.has(item.uuid),label=(chosen?'\u53d6\u6d88\u7f6e\u9876 ':'\u7f6e\u9876 ')+(item.name||'\u88c5\u5907');pin.title=label;pin.setAttribute('aria-label',label);pin.setAttribute('aria-pressed',String(chosen));});}
      function sync(){if(instance.isUnmounted||!bag.isConnected)return;const index=[...tabs.querySelectorAll(':scope > .bag-tab')].findIndex(node=>node.classList.contains('bag-tab--active'));state.kind=['equipment','materials','consumables'][index]||'equipment';bar.hidden=state.kind==='materials';state.selling=!!bag.querySelector('.bag-icon-btn--sell,.sell-mode-banner');if(state.selling){clearTimeout(queryTimer);queryTimer=null;if(state.kind!=='materials')search.value=views[state.kind].q;}bar.inert=state.selling||state.failed;bag.classList.toggle('amv-bag-selling',state.selling);bag.classList.toggle('amv-bag-pin-mode',state.pinMode&&state.kind==='equipment'&&!state.selling);if(!bar.hidden){const value=views[state.kind];if(currentKind!==state.kind){currentKind=state.kind;search.value=value.q;}search.placeholder=state.kind==='equipment'?'\u641c\u7d22\u88c5\u5907\u540d\u79f0\u2026':'\u641c\u7d22\u6d88\u8017\u54c1\u540d\u79f0\u2026';pinMode.hidden=state.kind!=='equipment';pinMode.setAttribute('aria-pressed',String(state.pinMode));expand.setAttribute('aria-expanded',String(state.expanded));details.hidden=!state.expanded;kindRow.hidden=state.kind!=='consumables';slotRow.hidden=state.kind!=='equipment';const source=sources.get(state.kind==='equipment'?'backpackEquipment':'backpackConsumables'),stars=[...new Set(source.map(item=>Number.isFinite(item?.rarity)?item.rarity:0))].sort((a,b)=>a-b),signature=state.kind+':'+stars.join(',');if(lastStars!==signature){lastStars=signature;starRow.querySelectorAll('button').forEach(node=>node.remove());for(const star of stars){const choice=button(star>0?star+'\u2605':'\u672a\u6807\u661f',()=>{const set=views[state.kind].stars;set.has(star)?set.delete(star):set.add(star);changed();});choice.dataset.amvBagStar=star;choice.style.setProperty('--amv-chip',rarityColors[star]||'#9ea3b0');starRow.append(choice);}}for(const choice of slotRow.querySelectorAll('button')){choice.setAttribute('aria-pressed',String(value.slots.has(choice.dataset.amvBagSlot)));choice.hidden=choice.dataset.amvBagSlot==='none'&&!source.some(item=>equipmentSlot(item)==='none');}for(const choice of starRow.querySelectorAll('button'))choice.setAttribute('aria-pressed',String(value.stars.has(Number(choice.dataset.amvBagStar))));for(const choice of elementRow.querySelectorAll('button'))choice.setAttribute('aria-pressed',String(value.elements.has(choice.dataset.amvBagElement)));for(const choice of kindRow.querySelectorAll('button'))choice.setAttribute('aria-pressed',String(value.type===choice.dataset.amvBagType));const rows=filtered(state.kind),next='\u663e\u793a '+rows.length+' / '+source.length;if(count.textContent!==next)count.textContent=next;notice.hidden=!state.selling&&!state.failed;notice.textContent=state.failed?'\u80cc\u5305\u7b5b\u9009\u6682\u4e0d\u53ef\u7528\uff0c\u6b63\u5728\u663e\u793a\u5b98\u7f51\u539f\u59cb\u5217\u8868\u3002':state.selling?'\u51fa\u552e\u6a21\u5f0f\u4e0b\u6682\u505c\u8c03\u6574\u7b5b\u9009\u548c\u7f6e\u9876\uff0c\u8bf7\u5148\u9000\u51fa\u51fa\u552e\u6a21\u5f0f\u3002':'';}cells();}
      function dispose(){clearTimeout(queryTimer);state.enabled=false;try{props[revision]++;for(const key of keys)Object.defineProperty(props,key,{...old.get(key),value:sources.get(key)});delete props[revision];}catch{}bag.removeEventListener('click',selectCard,true);bar.remove();tabs.classList.remove('amv-bag-tabs');bag.querySelectorAll('.amv-bag-pin').forEach(node=>node.remove());}
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
    if(!validRoleRecord(row))throw Error('\u8d26\u53f7\u6392\u5e8f\u6216\u5907\u6ce8\u8d85\u51fa\u957f\u5ea6\u9650\u5236');
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
      if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:label+'\u540c\u6b65\u6682\u4e0d\u53ef\u7528');
      if(data.version!==1||!Array.isArray(data.records)||data.records.length>500||!data.records.every(valid))throw Error(label+'\u540c\u6b65\u54cd\u5e94\u65e0\u6548');
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
      status(label+'\u5df2\u540c\u6b65');
    }
    async function synchronize(){
      if(busy){pending=true;return;}
      const device=config();
      if(!device){status(label+'\u5b58\u4e8e\u672c\u673a\uff0c\u7ed1\u5b9a\u540e\u4f1a\u81ea\u52a8\u540c\u6b65');return;}
      if(document.hidden){schedule(60000);return;}
      busy=true;pending=false;let failed=false;
      try{
        await navigator.locks.request(key+'-network',async()=>{
          if(config()?.token===device.token)await exchange(device);
        });
      }catch(error){
        failed=true;
        status((error.name==='AbortError'||error instanceof TypeError?label+'\u6682\u65f6\u65e0\u6cd5\u8fde\u63a5 Web':error.message)+'\uff0c\u672c\u673a\u4fee\u6539\u5df2\u4fdd\u7559');
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
      endpoint:'/api/aetheros/role-preferences/sync',label:'\u8d26\u53f7\u6392\u5e8f\u4e0e\u5907\u6ce8',
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
    if(!Array.isArray(stored.records)||!stored.records.every(validSupportPin))throw Error('\u672c\u673a\u597d\u53cb\u7f6e\u9876\u6570\u636e\u65e0\u6548');
    return stored;
  }
  function supportPins(){return new Set(supportPinState().records.filter(row=>row.value==='pinned').map(row=>row.key));}
  function toggleSupportPin(username){
    const state=supportPinState(),before=state.records.find(row=>row.key===username);
    const record={key:username,value:before?.value==='pinned'?null:'pinned',stamp:Math.max(Date.now(),(before?.stamp||0)+1),edit_id:crypto.randomUUID(),dirty:true};
    if(!validSupportPin(record))throw Error('\u597d\u53cb\u8d26\u53f7\u6807\u8bc6\u65e0\u6548');
    state.records=[...state.records.filter(row=>row.key!==username),record];
    localStorage.setItem(SUPPORT_PINS_KEY,JSON.stringify(state));
    window.dispatchEvent(new Event('aether-support-pins-change'));
    window.dispatchEvent(new Event('aether-support-sync-now'));
  }
  function initSupportPinSync(){
    initPreferenceSync({
      key:SUPPORT_PINS_KEY,read:supportPinState,write:state=>localStorage.setItem(SUPPORT_PINS_KEY,JSON.stringify(state)),
      valid:validSupportPin,changeEvent:'aether-support-pins-change',syncEvent:'aether-support-sync-now',
      endpoint:'/api/aetheros/support-pins/sync',label:'\u52a9\u6218\u597d\u53cb\u7f6e\u9876',
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
    input.type='text';input.maxLength=80;input.placeholder='\u8f93\u5165\u5907\u6ce8';input.setAttribute('aria-label','\u5907\u6ce8');
    const cancel=button('\u53d6\u6d88',()=>dialog.close()),confirm=element('button','\u4fdd\u5b58');confirm.type='submit';
    footer.append(cancel,confirm);form.append(title,input,footer);dialog.append(form);document.body.append(dialog);
    let saveNote;
    input.addEventListener('input',()=>input.setCustomValidity(''));
    form.addEventListener('submit',event=>{event.preventDefault();if(saveNote?.(input.value.trim()))dialog.close();});
    dialog.addEventListener('close',()=>{saveNote=null;});
    function editNote(name,note,save){
      title.textContent='\u7f16\u8f91\u5907\u6ce8 \u00b7 '+name;input.value=note;input.setCustomValidity('');saveNote=save;
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
          const username=body?.querySelector(':scope > small')?.textContent.trim().match(/^(.+)\s+\u00b7\s+Lv\./)?.[1].trim();
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
          catch{input.setCustomValidity('\u65e0\u6cd5\u4fdd\u5b58\u5907\u6ce8\uff0c\u8bf7\u68c0\u67e5\u6d4f\u89c8\u5668\u5b58\u50a8\u3002');input.reportValidity();return false;}
        }));
        pencil.title='\u7f16\u8f91\u5907\u6ce8';pencil.setAttribute('aria-label','\u7f16\u8f91 '+name+' \u7684\u5907\u6ce8');
        const icon=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS(icon.namespaceURI,'path');
        icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');
        path.setAttribute('d','M13.5 6.5l4 4M4 20l4.6-1 11-11a1.4 1.4 0 0 0 0-2l-1.6-1.6a1.4 1.4 0 0 0-2 0l-11 11L4 20z');
        icon.append(path);pencil.append(icon);
        const grip=element('span',undefined,'aether-inline-role-grip');
        grip.tabIndex=0;grip.title='\u62d6\u52a8\u6392\u5e8f\uff0c\u4e5f\u53ef\u6309\u4e0a\u4e0b\u65b9\u5411\u952e';
        grip.setAttribute('role','slider');grip.setAttribute('aria-orientation','vertical');
        grip.setAttribute('aria-label',name+'\u7684\u6392\u5e8f\u4f4d\u7f6e');grip.setAttribute('aria-valuemin','1');
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
      const toolbar=element('div',undefined,'aether-support-tools'),rows=button('\u884c\u663e\u793a',()=>{view='rows';saveView();}),table=button('\u5e73\u94fa\u663e\u793a',()=>{view='table';saveView();});
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
        const pin=button(pinned?'\u2605':'\u2606',()=>{
          try{toggleSupportPin(username);feedback.textContent='';schedule();}
          catch(error){feedback.textContent=error.message;}
        });
        pin.className='aether-support-pin';pin.setAttribute('aria-pressed',String(pinned));
        pin.setAttribute('aria-label',(pinned?'\u53d6\u6d88\u7f6e\u9876 ':'\u7f6e\u9876 ')+(item.meta.name||username));
        pin.title=(pinned?'\u53d6\u6d88\u7f6e\u9876':'\u7f6e\u9876\u597d\u53cb')+' \u00b7 '+username;
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
        grid.setAttribute('aria-label','\u5e73\u94fa\u89d2\u8272\u5217\u8868');
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
      try{visit(app._vnode);}catch(error){console.warn('AetherOS \u52a9\u6218\u5217\u8868',error);}
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
      set.call(storage,key,JSON.stringify(character));if(storage.getItem(ACTIVE)!==character)throw new Error('\u89d2\u8272\u9694\u79bb\u672a\u751f\u6548');notify();
      ready(initEquipmentUsage);ready(initSpectrumLevelTooltips);ready(initPluginSettings);ready(initOfficialRolePreferences);ready(initOfficialRoleNotes);ready(initSupportPicker);ready(initBackpackFilters);ready(initReinforceFilters);ready(initCustomLoadouts);
    }catch{
      window.stop();window.parent.postMessage({type:CHANNEL,id:context.id,error:true},ORIGIN);
      ready(()=>{const text=element('div','\u89d2\u8272\u9694\u79bb\u672a\u5c31\u7eea\uff0c\u8bf7\u5173\u95ed\u6b64\u533a\u57df\u540e\u91cd\u5f00\u3002');text.style.cssText='position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:#111b29;color:#e4edf5;font:14px sans-serif';document.body.append(text);});
    }
    return;
  }
  if(window.top!==window)return;
  ready(initBackpackFilters);ready(initReinforceFilters);
  ready(initEquipmentUsage);ready(initSpectrumLevelTooltips);ready(initPluginSettings);ready(initOfficialRolePreferences);ready(initOfficialRoleNotes);ready(initSupportPicker);ready(initCustomLoadouts);
  ready(initScriptUpdates);
  ready(initScriptNavigation);
  ready(initPinSync);ready(initLoadoutSync);ready(initReinforceHistorySync);ready(initReinforceBulkRead);
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
    const launch=button('\u591a\u89d2\u8272\u540c\u5c4f',open),root=element('section'),status=element('p','\u6b63\u5728\u8bfb\u53d6\u5b98\u7f51\u89d2\u8272\u5217\u8868\u2026','amv-status'),roles=element('section',undefined,'amv-roles'),roleList=element('div',undefined,'amv-role-list'),stage=element('div',undefined,'amv-desktop'),taskbar=element('footer',undefined,'amv-taskbar'),tasks=element('div',undefined,'amv-tasks'),empty=element('p','\u70b9\u51fb\u5e95\u90e8\u201c\u6253\u5f00\u89d2\u8272\u201d\u9009\u62e9\u8d26\u53f7\uff1b\u62d6\u52a8\u6807\u9898\u680f\u79fb\u52a8\uff0c\u62d6\u52a8\u8fb9\u89d2\u8c03\u6574\u5927\u5c0f\u3002','amv-empty'),snapMenu=element('section',undefined,'amv-snap-menu'),snapList=element('div',undefined,'amv-snap-list'),preview=element('div',undefined,'amv-snap-preview'),assist=element('section',undefined,'amv-snap-assist'),assistHint=element('strong'),assistList=element('div',undefined,'amv-assist-list');launch.id='aether-multiview-launch';root.id='aether-multiview';root.hidden=true;roles.hidden=true;snapMenu.hidden=true;assist.hidden=true;preview.hidden=true;preview.setAttribute('aria-hidden','true');status.setAttribute('aria-live','polite');root.setAttribute('aria-label','Aether \u591a\u89d2\u8272\u540c\u5c4f');roles.setAttribute('aria-label','\u89d2\u8272\u5217\u8868');stage.setAttribute('aria-label','\u89d2\u8272\u684c\u9762');taskbar.setAttribute('aria-label','\u89d2\u8272\u7a97\u53e3\u680f');snapMenu.setAttribute('aria-label','\u8d34\u9760\u5e03\u5c40');snapMenu.setAttribute('role','dialog');stage.append(empty,preview);
    let characters=[],busy=false,active=false,loaded=false,previousInert=false,pending=null,activeId=null,gesture=null,z=0,snapOwner=null,snapTimer=null,snapCloseTimer=null,snapGroup=null;const panes=new Map(),timers=new Set();let config={scale:50,characters:null,windows:Object.create(null)};try{const value=JSON.parse(localStorage.getItem(CONFIG)||'null');if([40,50,60,75,100].includes(value?.scale))config.scale=value.scale;if(Array.isArray(value?.characters))config.characters=value.characters.filter(name=>typeof name==='string');if(value?.windows&&typeof value.windows==='object'&&!Array.isArray(value.windows))config.windows=Object.assign(Object.create(null),value.windows);}catch{}
    const manage=button('\u6253\u5f00\u89d2\u8272',()=>{if(!roles.hidden){closeMenus();return;}closeSnap();closeAssist();roles.hidden=false;manage.setAttribute('aria-expanded','true');preferences=readRolePreferences();renderRoles();}),all=button('\u6253\u5f00\u5168\u90e8',()=>{orderedRoles().forEach((row,index)=>openPane(row.username,index*400));closeMenus();}),close=button('\u9000\u51fa\u684c\u9762',leave),roleFooter=element('footer'),assistHeader=element('header');manage.dataset.amvManage='';manage.setAttribute('aria-expanded','false');all.dataset.amvAll='';close.dataset.amvClose='';manage.classList.add('amv-shell-control');manage.setAttribute('aria-label','\u6253\u5f00\u89d2\u8272');manage.title='\u6253\u5f00\u89d2\u8272';close.classList.add('amv-shell-control');close.setAttribute('aria-label','\u9000\u51fa\u684c\u9762');close.title='\u9000\u51fa\u684c\u9762';controlIcon(manage,'start');controlIcon(close,'exit');taskbar.append(manage,tasks,close);const checkUpdate=button('\u68c0\u67e5\u66f4\u65b0',()=>window.dispatchEvent(new Event('aether-userscript-check-updates')));checkUpdate.dataset.amvCheckUpdate='';const syncPins=button('\u540c\u6b65\u7f6e\u9876',()=>window.dispatchEvent(new Event('aether-pins-settings')));syncPins.dataset.amvPinOpen='';roleFooter.append(element('span','v'+SCRIPT_VERSION,'amv-script-version'),syncPins,checkUpdate,all);roles.append(element('h2','Aether \u591a\u89d2\u8272\u540c\u5c4f'),status,roleList,roleFooter);snapMenu.append(element('strong','\u8d34\u9760\u5e03\u5c40'),snapList);assistHeader.append(assistHint,button('\u5b8c\u6210',closeAssist));assist.append(assistHeader,assistList);root.append(stage,taskbar,roles,snapMenu,assist);document.body.append(root,launch);
    const clamp=(value,min,max)=>Math.max(min,Math.min(max,value)),bounds=()=>({w:stage.clientWidth,h:stage.clientHeight}),finite=(value,fallback)=>Number.isFinite(value)?value:fallback;
    function controlIcon(node,kind){if(node.dataset.icon===kind)return;const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),paths={minimize:'M5 10h10',maximize:'M5 5h10v10H5Z',restore:'M7 5V3h10v10h-2M3 7h10v10H3Z',reload:'M15 6A6 6 0 1 0 16 12M15 3v4h-4',close:'m5 5 10 10M15 5 5 15',start:'M3 3h5v5H3ZM12 3h5v5h-5ZM3 12h5v5H3ZM12 12h5v5h-5Z',exit:'M8 4H4v12h4m4-11 5 5-5 5M8 10h9'};svg.setAttribute('viewBox','0 0 20 20');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.25');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');svg.classList.add('amv-control-icon');const path=document.createElementNS(ns,'path');path.setAttribute('d',paths[kind]);svg.append(path);node.dataset.icon=kind;node.replaceChildren(svg);}
    function name(username){const row=characters.find(row=>row.username===username);return row?.name&&row.name!==username?row.name+' \u00b7 '+username:username||'\u9009\u62e9\u89d2\u8272';}
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
        choice.title=[name(row.username),note,existing?'\u5df2\u6253\u5f00':''].filter(Boolean).join(' \u00b7 ');
        choice.disabled=!loaded;choice.dataset.amvRole=row.username;choice.dataset.open=existing;
        choice.setAttribute('aria-pressed',String(existing));roleList.append(choice);
      }
    }
    function refresh(){
      empty.hidden=panes.size>0;
      if(loaded)status.textContent=panes.size+' / '+characters.length+' \u4e2a\u89d2\u8272\u7a97\u53e3';
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
        pane.task.title=[name(pane.character),note,pane.minimized?'\u5df2\u6700\u5c0f\u5316':''].filter(Boolean).join(' \u00b7 ');
      });
    }
    const refreshRolePreferences=()=>{preferences=readRolePreferences();if(active)refresh();};
    window.addEventListener('storage',event=>{if(event.key===ROLE_PREFERENCES_KEY)refreshRolePreferences();});
    window.addEventListener('aether-role-preferences-change',refreshRolePreferences);
    function paint(pane){const area=bounds(),rect=pane.maximized?{x:8,y:8,w:Math.max(1,area.w-16),h:Math.max(1,area.h-16)}:fit(pane.snap?zoneRect(pane.snap):pane.rect);pane.display=rect;pane.node.style.setProperty('--amv-scale',pane.scale/100);pane.scaleSelect.value=String(pane.scale);Object.assign(pane.node.style,{left:rect.x+'px',top:rect.y+'px',width:rect.w+'px',height:rect.h+'px',zIndex:pane.order});pane.node.hidden=pane.minimized;pane.node.dataset.active=String(activeId===pane.id&&!pane.minimized);pane.node.classList.toggle('is-maximized',pane.maximized);controlIcon(pane.maximize,pane.maximized?'restore':'maximize');updateIcon(pane.titleIcon,pane.character);pane.maximize.setAttribute('aria-label',(pane.maximized?'\u8fd8\u539f':'\u6700\u5927\u5316')+' '+name(pane.character));}
    function layout(){panes.forEach(paint);positionSnap();if(snapGroup){const preset=presets.find(item=>item.id===snapGroup.layout),index=preset.zones.findIndex((_,i)=>!snapGroup.placed.has(i));if(index>=0)previewZone({layout:snapGroup.layout,index});}}
    function activate(id,restore=false){const pane=panes.get(id);if(!pane)return;if(restore)pane.minimized=false;if(pane.minimized)return;if(activeId!==id||restore){activeId=id;pane.order=++z;layout();refresh();save();}}
    function toggleMax(id){closeSnap();closeAssist();const pane=panes.get(id);if(!pane)return;pane.maximized=!pane.maximized;activate(id,true);layout();save();}
    const presets=[
      {id:'full',label:'\u94fa\u6ee1',zones:[[0,0,1,1]]},{id:'halves',label:'\u5de6\u53f3\u5206\u5c4f',zones:[[0,0,.5,1],[.5,0,.5,1]]},{id:'wide',label:'\u5de6\u5bbd\u53f3\u7a84',zones:[[0,0,2/3,1],[2/3,0,1/3,1]]},
      {id:'thirds',label:'\u4e09\u5217',zones:[[0,0,1/3,1],[1/3,0,1/3,1],[2/3,0,1/3,1]]},{id:'center',label:'\u4e2d\u95f4\u5bbd\u5c4f',zones:[[0,0,.25,1],[.25,0,.5,1],[.75,0,.25,1]]},{id:'rows',label:'\u4e0a\u4e0b\u5206\u5c4f',zones:[[0,0,1,.5],[0,.5,1,.5]]},
      {id:'quarters',label:'\u56db\u5bab\u683c',zones:[[0,0,.5,.5],[.5,0,.5,.5],[0,.5,.5,.5],[.5,.5,.5,.5]]},{id:'six',label:'\u516d\u5bab\u683c',zones:Array.from({length:6},(_,i)=>[(i%3)/3,Math.floor(i/3)/2,1/3,.5])},{id:'nine',label:'\u4e5d\u5bab\u683c',zones:Array.from({length:9},(_,i)=>[(i%3)/3,Math.floor(i/3)/3,1/3,1/3])}
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
    function openSnap(id){const pane=panes.get(id);if(!pane||pane.minimized)return;clearTimeout(snapTimer);clearTimeout(snapCloseTimer);closeAssist();roles.hidden=true;manage.setAttribute('aria-expanded','false');snapOwner=id;activate(id);snapList.replaceChildren();for(const preset of presets){const card=element('div',undefined,'amv-snap-card'),mini=element('div',undefined,'amv-snap-mini');card.dataset.amvSnapLayout=preset.id;preset.zones.forEach(([x,y,w,h],index)=>{const target={layout:preset.id,index},choice=button('',()=>applySnap(id,target));choice.dataset.amvSnapZone=index;choice.setAttribute('aria-label',preset.label+'\uff0c'+(index+1)+'\u53f7\u4f4d\u7f6e');choice.title=preset.label+' \u00b7 '+(index+1)+'\u53f7\u4f4d\u7f6e';choice.disabled=!canSnap(target);Object.assign(choice.style,{left:'calc('+x*100+'% + 1px)',top:'calc('+y*100+'% + 1px)',width:'calc('+w*100+'% - 2px)',height:'calc('+h*100+'% - 2px)'});choice.addEventListener('pointerenter',()=>previewZone(target));choice.addEventListener('focus',()=>previewZone(target));mini.append(choice);});card.append(mini,element('small',preset.label));snapList.append(card);}snapMenu.hidden=false;positionSnap();}
    function applySnap(id,target){const pane=panes.get(id);if(!pane||!canSnap(target))return;closeSnap();if(target.layout==='full'){closeAssist();pane.minimized=false;pane.maximized=true;activate(id,true);layout();save();return;}pane.minimized=false;pane.maximized=false;pane.snap={...target};pane.rect=zoneRect(target);activate(id,true);layout();save();snapGroup={layout:target.layout,placed:new Map([[target.index,id]])};renderAssist();}
    function renderAssist(){if(!snapGroup)return;const preset=presets.find(item=>item.id===snapGroup.layout),next=preset.zones.findIndex((_,index)=>!snapGroup.placed.has(index)),available=[...panes.values()].filter(pane=>![...snapGroup.placed.values()].includes(pane.id));if(next<0||!available.length){closeAssist();return;}assistHint.textContent=preset.label+' \u00b7 \u9009\u62e9\u7a97\u53e3\u586b\u5165 '+(next+1)+' \u53f7\u4f4d\u7f6e';assistList.replaceChildren();for(const pane of available){const choice=button('',()=>{const target={layout:snapGroup.layout,index:next};if(!canSnap(target)){closeAssist();return;}pane.minimized=false;pane.maximized=false;pane.snap=target;pane.rect=zoneRect(target);snapGroup.placed.set(next,pane.id);activate(pane.id,true);layout();save();renderAssist();}),icon=element('span',undefined,'amv-avatar');choice.dataset.amvAssistPane=pane.id;updateIcon(icon,pane.character);choice.append(icon,element('span',name(pane.character)));assistList.append(choice);}assist.hidden=false;previewZone({layout:snapGroup.layout,index:next});}
    function dragTarget(event){const box=stage.getBoundingClientRect(),x=event.clientX-box.left,y=event.clientY-box.top;let target=null;if(x<24||x>box.width-24){const right=x>box.width/2;if(y<64||y>box.height-64)target={layout:'quarters',index:(y>box.height/2?2:0)+(right?1:0)};else target={layout:'halves',index:right?1:0};}else if(y<24)target={layout:'full',index:0};return target&&canSnap(target)?target:null;}
    function startGesture(event,pane,edge){if(event.button!==0||pane.maximized||gesture)return;if(!edge&&event.target.closest('button,input,select,a'))return;event.preventDefault();closeMenus();activate(pane.id);pane.snap=null;pane.rect={...pane.display};gesture={pane,edge,x:event.clientX,y:event.clientY,rect:{...pane.display},pointer:event.pointerId,target:event.currentTarget};gesture.target.setPointerCapture(event.pointerId);root.classList.add('amv-moving');}
    function moveGesture(event){if(!gesture||event.pointerId!==gesture.pointer)return;const {pane,edge,x,y,rect}=gesture,dx=event.clientX-x,dy=event.clientY-y,area=bounds();let next={...rect};if(!edge){next.x+=dx;next.y+=dy;}else{if(edge.includes('e'))next.w=clamp(rect.w+dx,Math.min(320,area.w-16),area.w-rect.x-8);if(edge.includes('s'))next.h=clamp(rect.h+dy,Math.min(220,area.h-16),area.h-rect.y-8);if(edge.includes('w')){next.x=clamp(rect.x+dx,8,rect.x+rect.w-Math.min(320,area.w-16));next.w=rect.x+rect.w-next.x;}if(edge.includes('n')){next.y=clamp(rect.y+dy,8,rect.y+rect.h-Math.min(220,area.h-16));next.h=rect.y+rect.h-next.y;}}pane.rect=fit(next);paint(pane);gesture.snapTarget=edge?null:dragTarget(event);previewZone(gesture.snapTarget);}
    function finishGesture(event){if(!gesture||event?.pointerId!==undefined&&event.pointerId!==gesture.pointer)return;const {target,pointer,pane,snapTarget}=gesture;gesture=null;if(target.hasPointerCapture(pointer))target.releasePointerCapture(pointer);root.classList.remove('amv-moving');preview.hidden=true;if(event?.type==='pointerup'&&snapTarget)applySnap(pane.id,snapTarget);else save();}
    function openPane(character,delay=0,restoring=false){const existing=[...panes.values()].find(pane=>pane.character===character);if(existing){activate(existing.id,true);return;}const id=crypto.randomUUID(),node=element('section',undefined,'amv-pane'),header=element('header'),caption=element('strong',name(character)),titleIcon=element('span',undefined,'amv-avatar amv-title-avatar'),state=element('small','\u8f7d\u5165\u4e2d'),frame=element('iframe'),viewport=element('div',undefined,'amv-viewport'),minimize=button('\u2014',()=>{pane.minimized=true;activeId=null;const next=[...panes.values()].filter(value=>!value.minimized).sort((a,b)=>b.order-a.order)[0];if(next)activate(next.id);layout();refresh();save();}),maximize=button('\u25a1',()=>toggleMax(id)),scaleSelect=element('select'),reload=button('\u91cd\u8f7d',()=>{pane.failed=false;pane.ready=false;node.classList.remove('is-ready');frame.inert=true;frame.tabIndex=-1;state.textContent='\u8f7d\u5165\u4e2d';frame.src=frame.src;}),remove=button('\u00d7',()=>{finishGesture();save();node.remove();panes.delete(id);if(activeId===id)activeId=null;refresh();save();});node.dataset.amvPane=id;node.dataset.character=character;node.setAttribute('role','region');node.setAttribute('aria-label',name(character)+'\u7684\u89d2\u8272\u7a97\u53e3');frame.title=name(character)+'\u7684\u5b98\u65b9\u754c\u9762';frame.name=PREFIX+JSON.stringify({id,character});frame.referrerPolicy='same-origin';frame.inert=true;frame.tabIndex=-1;minimize.setAttribute('aria-label','\u6700\u5c0f\u5316 '+name(character));remove.setAttribute('aria-label','\u5173\u95ed '+name(character));maximize.dataset.amvMaximize=id;maximize.setAttribute('aria-haspopup','dialog');maximize.title='\u60ac\u505c\u9009\u62e9\u8d34\u9760\u5e03\u5c40\uff1b\u70b9\u51fb\u6700\u5927\u5316\uff1b\u53f3\u952e\u6216\u5411\u4e0b\u952e\u6253\u5f00\u5e03\u5c40';caption.title=name(character);state.title='\u8f7d\u5165\u4e2d';for(const [control,kind,label] of [[minimize,'minimize','\u6700\u5c0f\u5316'],[maximize,'maximize','\u6700\u5927\u5316'],[reload,'reload','\u91cd\u8f7d'],[remove,'close','\u5173\u95ed']]){control.classList.add('amv-control');control.title=label;controlIcon(control,kind);}reload.setAttribute('aria-label','\u91cd\u8f7d');maximize.title='\u60ac\u505c\u9009\u62e9\u8d34\u9760\u5e03\u5c40\uff1b\u70b9\u51fb\u6700\u5927\u5316\uff1b\u53f3\u952e\u6216\u5411\u4e0b\u952e\u6253\u5f00\u5e03\u5c40';scaleSelect.className='amv-scale';scaleSelect.dataset.amvScale='';scaleSelect.setAttribute('aria-label','\u5185\u5bb9\u7f29\u653e '+name(character));for(const value of [40,50,60,75,100]){const option=element('option',value+'%');option.value=value;scaleSelect.append(option);}scaleSelect.addEventListener('change',()=>{pane.scale=Number(scaleSelect.value);paint(pane);save();});header.append(titleIcon,caption,state,scaleSelect,minimize,maximize,reload,remove);viewport.append(frame);node.append(header,viewport);
      const saved=Object.hasOwn(config.windows,character)?config.windows[character]:null,rect=saved&&typeof saved==='object'?{x:finite(saved.x,16),y:finite(saved.y,16),w:finite(saved.w,760),h:finite(saved.h,600)}:initial(panes.size),pane={id,node,caption,titleIcon,state,frame,minimize,maximize,remove,scaleSelect,scale:[40,50,60,75,100].includes(saved?.scale)?saved.scale:config.scale,snap:validSnap(saved?.snap),character,rect,display:rect,minimized:restoring&&saved?.minimized===true,maximized:saved?.maximized===true,order:restoring?finite(saved?.order,++z):++z,failed:false,ready:false};z=Math.max(z,pane.order);panes.set(id,pane);stage.append(node);node.addEventListener('pointerdown',()=>activate(id));header.addEventListener('pointerdown',event=>startGesture(event,pane,''));header.addEventListener('dblclick',event=>{if(!event.target.closest('button,select'))toggleMax(id);});maximize.addEventListener('pointerenter',()=>{clearTimeout(snapCloseTimer);snapTimer=setTimeout(()=>openSnap(id),300);});maximize.addEventListener('pointerleave',()=>{clearTimeout(snapTimer);snapCloseTimer=setTimeout(closeSnap,200);});maximize.addEventListener('contextmenu',event=>{event.preventDefault();openSnap(id);});maximize.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();openSnap(id);}});
      for(const edge of ['n','e','s','w','ne','se','sw','nw']){const handle=element('div',undefined,'amv-handle');handle.dataset.edge=edge;handle.addEventListener('pointerdown',event=>startGesture(event,pane,edge));if(edge==='se'){handle.tabIndex=0;handle.setAttribute('role','button');handle.setAttribute('aria-label','\u8c03\u6574\u7a97\u53e3\u5927\u5c0f\uff0c\u65b9\u5411\u952e\u8c03\u6574');handle.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)||pane.maximized)return;event.preventDefault();activate(id);pane.snap=null;pane.rect=fit({...pane.display,w:pane.display.w+(event.key==='ArrowRight'?16:event.key==='ArrowLeft'?-16:0),h:pane.display.h+(event.key==='ArrowDown'?16:event.key==='ArrowUp'?-16:0)});layout();save();});}node.append(handle);}
      frame.addEventListener('load',()=>{if(frame.getAttribute('src')&&!pane.failed)state.textContent=pane.ready?'\u5df2\u8f7d\u5165':'\u5185\u5d4c\u9875\u672a\u8fd0\u884c\u811a\u672c\uff0c\u8bf7\u68c0\u67e5\u6cb9\u7334\u8bbe\u7f6e';state.title=state.textContent;});const timer=setTimeout(()=>{timers.delete(timer);if(!active||!panes.has(id))return;const url=new URL('/aether/',ORIGIN);url.searchParams.set('aether_mv_pane',id);url.searchParams.set('aether_mv_character',character);frame.src=url.href;},delay);timers.add(timer);if(!restoring)activate(id,true);layout();refresh();if(!restoring)save();
    }
    async function open(){if(busy||active)return;root.hidden=false;active=true;loaded=false;document.documentElement.classList.add('amv-open');const app=document.getElementById('app');previousInert=!!app?.inert;if(app)app.inert=true;busy=true;manage.disabled=all.disabled=true;roles.hidden=false;manage.setAttribute('aria-expanded','true');status.textContent='\u6b63\u5728\u8bfb\u53d6\u5b98\u7f51\u89d2\u8272\u5217\u8868\u2026';renderRoles();const controller=new AbortController();pending=controller;const timeout=setTimeout(()=>controller.abort(),12000);
      try{const response=await fetch('/api/aether/account',{credentials:'same-origin',cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error(response.status===401?'\u8bf7\u5148\u5728\u539f\u5b98\u7f51\u767b\u5f55\uff0c\u518d\u6253\u5f00\u591a\u89d2\u8272\u540c\u5c4f\u3002':'\u6682\u65f6\u65e0\u6cd5\u8bfb\u53d6\u89d2\u8272\u5217\u8868\uff0c\u53ef\u8fd4\u56de\u5355\u89d2\u8272\u540e\u91cd\u8bd5\u3002');const value=await response.json();if(!active||pending!==controller)return;if(value?.code!==0||!Array.isArray(value.data?.characters))throw new Error('\u5b98\u7f51\u89d2\u8272\u5217\u8868\u683c\u5f0f\u53d1\u751f\u53d8\u5316\uff0c\u8bf7\u8fd4\u56de\u5355\u89d2\u8272\u4f7f\u7528\u3002');characters=[...new Map(value.data.characters.filter(row=>typeof row?.username==='string'&&row.username.trim()).map(row=>[row.username,row])).values()];const available=new Set(characters.map(row=>row.username)),selected=Array.isArray(config.characters)?[...new Set(config.characters.filter(character=>available.has(character)))]:[];selected.forEach((character,index)=>openPane(character,index*400,true));loaded=true;const top=[...panes.values()].filter(pane=>!pane.minimized).sort((a,b)=>b.order-a.order)[0];activeId=top?.id||null;roles.hidden=panes.size>0;manage.setAttribute('aria-expanded',String(!roles.hidden));layout();refresh();}catch(error){if(active&&pending===controller)status.textContent=error.name==='AbortError'?'\u8bfb\u53d6\u89d2\u8272\u5217\u8868\u8d85\u65f6\uff0c\u8bf7\u8fd4\u56de\u5355\u89d2\u8272\u540e\u91cd\u8bd5\u3002':error instanceof SyntaxError||error instanceof TypeError?'\u6682\u65f6\u65e0\u6cd5\u8bfb\u53d6\u5b98\u7f51\u89d2\u8272\u5217\u8868\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002':error.message;}finally{clearTimeout(timeout);if(pending===controller){pending=null;busy=false;manage.disabled=false;all.disabled=!loaded;}}}
    function leave(){closeMenus();finishGesture();save();active=false;loaded=false;pending?.abort();pending=null;busy=false;timers.forEach(clearTimeout);timers.clear();panes.forEach(pane=>pane.node.remove());panes.clear();tasks.replaceChildren();activeId=null;root.hidden=true;roles.hidden=true;document.documentElement.classList.remove('amv-open');const app=document.getElementById('app');if(app)app.inert=previousInert;launch.focus();}
    snapMenu.addEventListener('pointerenter',()=>clearTimeout(snapCloseTimer));snapMenu.addEventListener('pointerleave',()=>snapCloseTimer=setTimeout(closeSnap,200));root.addEventListener('pointerdown',event=>{if(!event.target.closest('.amv-snap-menu,.amv-snap-assist,.amv-roles,[data-amv-manage],[data-amv-maximize]'))closeMenus();});window.addEventListener('keydown',event=>{if(active&&event.key==='Escape')closeMenus();});
    window.addEventListener('pointermove',moveGesture);window.addEventListener('pointerup',finishGesture);window.addEventListener('pointercancel',finishGesture);window.addEventListener('blur',finishGesture);window.addEventListener('resize',()=>{if(active)layout();});new ResizeObserver(()=>{if(active)layout();}).observe(stage);
    window.addEventListener('message',event=>{if(event.origin!==ORIGIN||event.data?.type!==CHANNEL)return;const pane=panes.get(event.data.id);if(!pane||event.source!==pane.frame.contentWindow)return;if(event.data.activate){closeMenus();activate(pane.id);return;}if(event.data.dismiss){closeMenus();return;}if(event.data.error){pane.failed=true;pane.ready=false;pane.node.classList.remove('is-ready');pane.frame.inert=true;pane.frame.tabIndex=-1;pane.state.textContent='\u9694\u79bb\u672a\u5c31\u7eea\uff0c\u8bf7\u91cd\u8f7d';pane.state.title=pane.state.textContent;return;}if(typeof event.data.character!=='string'||pane.failed)return;pane.ready=true;pane.node.classList.add('is-ready');pane.frame.inert=false;pane.frame.tabIndex=0;pane.character=event.data.character;pane.node.dataset.character=pane.character;pane.node.setAttribute('aria-label',name(pane.character)+'\u7684\u89d2\u8272\u7a97\u53e3');pane.caption.textContent=name(pane.character);pane.caption.title=name(pane.character);pane.scaleSelect.setAttribute('aria-label','\u5185\u5bb9\u7f29\u653e '+name(pane.character));pane.minimize.setAttribute('aria-label','\u6700\u5c0f\u5316 '+name(pane.character));pane.remove.setAttribute('aria-label','\u5173\u95ed '+name(pane.character));pane.frame.title=name(pane.character)+'\u7684\u5b98\u65b9\u754c\u9762';refresh();save();});
  });
})();
