// Vue production fixture: mobile taps mount the same item-sheet structure as
// the official BackpackPanel. All actions operate on synthetic items only.
const {createApp,defineComponent,h,ref,computed,reactive,Fragment,Teleport}=Vue;
const state=reactive(window.backpackFixture),selected=ref(null),actions=[];
window.backpackOwner=state;window.backpackActions=actions;window.closeSheet=()=>selected.value=null;
const VTooltip=defineComponent({name:'VTooltip',props:['item'],setup(props){return()=>h('div',{class:'bag-grid-item',onClick:()=>selected.value=props.item},props.item.name);}});
const BackpackPanel=defineComponent({__name:'BackpackPanel',props:['backpackEquipment','backpackConsumables'],setup(props){const active=ref('equipment');return()=>h('section',{class:'bag-card'},[
 h('header',{class:'bag-header'},[h('h2','背包')]),h('div',{class:'bag-tabs'},['equipment','consumables'].map((kind,i)=>h('button',{class:['bag-tab',{'bag-tab--active':active.value===kind}],onClick:()=>active.value=kind},['装备','消耗品'][i]))),
 h('div',{class:'bag-grid'},(active.value==='equipment'?props.backpackEquipment:props.backpackConsumables).slice(0,30).map(item=>h(VTooltip,{key:item.uuid,item}))),
 selected.value?h(Teleport,{to:'body'},h('div',{class:'v-overlay v-dialog v-overlay--active'},h('div',{class:'v-overlay__content'},h('section',{class:'item-sheet'},[
 h('header',{class:'item-sheet__head'},[h('strong',{class:'item-sheet__title'},'+'+(selected.value.reinforce_level||0)+' '+selected.value.name),h('button',{'aria-label':'关闭物品详情',onClick:()=>selected.value=null},'×')]),
 h('div',{class:'item-sheet__body ae-scroll'},h('div',{class:'equip-tooltip item-sheet__info',innerHTML:window.nativeEquipmentHTML(selected.value)})),
 h('footer',{class:'item-sheet__actions'},selected.value.kind==='equipment'?[
 h('button',{class:'ae-btn item-sheet__primary',onClick:()=>{actions.push({kind:'equip',uuid:selected.value.uuid});selected.value=null;}},'替换装备'),
 h('div',{class:'item-sheet__row'},[
 h('button',{'data-v-mobile-fixture':'',class:'ae-btn',disabled:!!selected.value.locked,onClick:()=>actions.push({kind:'decompose',uuid:selected.value.uuid})},'分解'),
 h('button',{class:'ae-btn',onClick:()=>{selected.value.locked=!selected.value.locked;actions.push({kind:'lock',uuid:selected.value.uuid});}},selected.value.locked?'解锁':'锁定'),
 h('button',{'data-v-mobile-fixture':'',class:'ae-btn',disabled:!!selected.value.locked,onClick:()=>actions.push({kind:'sell',uuid:selected.value.uuid})},'出售')]),
 selected.value.locked?h('p',{class:'item-sheet__hint'},'已锁定的装备不能分解或出售。'):null
 ]:[h('button',{class:'ae-btn item-sheet__primary',onClick:()=>actions.push({kind:'use',uuid:selected.value.uuid})},'使用')])
 ])))):null
 ]);}});
const app=createApp({setup(){return()=>h('main',{class:'aether-console'},[h('header',{class:'console-header'},h('div',{class:'header-actions'},h('button','设置'))),h(BackpackPanel,{backpackEquipment:state.backpack.equipment,backpackConsumables:state.backpack.consumables})]);}});
app.config.globalProperties.$pinia={_s:new Map([['player',{get statusData(){return state;}}]])};app.mount('#app');
