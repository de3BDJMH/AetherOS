const {createApp,h,ref,Teleport}=Vue;
createApp({setup(){const opened=ref(false),selected=ref('game'),managed=ref(false),volume=ref(50);window.nativeSettings={opened,selected,managed,volume};
  return()=>h('div',{class:'aether-console'},[
    h('header',{class:'console-header'},[h('span','Aether'),h('div',{class:'header-actions'},[h('button',{onClick:()=>opened.value=true},'设置'),h('button','登出')])]),
    h('div',{class:'console-layout'},[h('aside',{class:'canvas-panel'},'LIVE FEED'),h('main','角色状态')]),
    opened.value?h(Teleport,{to:'body'},h('div',{class:'v-overlay-container'},h('div',{class:'v-overlay__content',role:'dialog','aria-label':'设置'},h('section',{class:'settings-card'},[
      h('h2',{class:'settings-title'},'设置'),h('div',{class:'settings-tabs',role:'tablist'},h('div',{class:'v-slide-group__content'},['game','audio'].map((value,index)=>h('button',{role:'tab','aria-selected':String(selected.value===value),tabindex:selected.value===value?0:-1,onClick:()=>selected.value=value},index?'音频':'游戏')))),
      h('div',{class:'settings-window'},selected.value==='game'?[h('label',[h('input',{type:'checkbox',checked:managed.value,onChange:event=>managed.value=event.target.checked}),'加入地下城自动托管'])]:[h('label',['音乐',h('input',{type:'range',min:0,max:100,value:volume.value,onInput:event=>volume.value=Number(event.target.value)})])]),
      h('footer',{class:'settings-actions'},h('button',{onClick:()=>opened.value=false},'关闭'))
    ])))):null
  ]);
}}).mount('#app');
