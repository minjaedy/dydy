// Shared by the page and service worker. Only counts and owner identifiers.
(()=>{
  const validOwner=x=>x==='rabbit'||x==='sweet';
  function accept(previous,snapshot){
    return validOwner(snapshot?.owner)&&Number.isSafeInteger(snapshot.count)&&snapshot.count>=0&&Number.isSafeInteger(snapshot.version)&&snapshot.version>=0&&(!previous||previous.owner!==snapshot.owner||previous.version<=snapshot.version);
  }
  async function apply(count){try{if(count)await navigator.setAppBadge?.(count);else await navigator.clearAppBadge?.();}catch{}}
  self.CoupleBadge={validOwner,accept,apply};
})();
