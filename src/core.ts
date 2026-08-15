import type {Diff,EditableItem,EntityState,Palette,SceneEntry,SceneExport,Session,Transform} from './types'

export const cloneTransform=(t:Transform):Transform=>({position:[...t.position],rotation:[...t.rotation],scale:[...t.scale]})
export const unityToThree=(t:Transform):Transform=>({position:[t.position[0],t.position[1],-t.position[2]],rotation:[-t.rotation[0],-t.rotation[1],t.rotation[2],t.rotation[3]],scale:[...t.scale]})
export const threeToUnity=unityToThree
const round=(n:number)=>Math.abs(n)<1e-12?0:Number(n.toFixed(10))
export const normalizeTransform=(t:Transform):Transform=>({position:t.position.map(round) as Transform['position'],rotation:t.rotation.map(round) as Transform['rotation'],scale:t.scale.map(round) as Transform['scale']})
export const sameTransform=(a:Transform,b:Transform)=>JSON.stringify(normalizeTransform(a))===JSON.stringify(normalizeTransform(b))

// ------------------------------------------------------------------ state

export const STATE_KEYS=['parentId','active','layer','tag','staticFlags','materialVariant'] as const

/**
 * The baseline a session diffs against.
 *
 * Every key is filled, even where the export omitted it. A key left undefined
 * cannot be conflict-checked at import, and the ways out of that are "send the
 * change with no prior" (the importer has to trust it) or "drop the user's
 * edit silently". Both are worse than substituting Unity's own default and
 * letting the importer refuse when the live scene disagrees — refusing is the
 * safe direction, and it names the object when it happens.
 */
export function baselineState(e:SceneEntry):Required<EntityState>{
  const s=e.state??{}
  return {
    parentId:e.parentId??null,
    active:s.active??true,
    layer:s.layer??'Default',
    tag:s.tag??'Untagged',
    staticFlags:s.staticFlags??[],
    materialVariant:s.materialVariant??null,
  }
}

const sameStateValue=(a:unknown,b:unknown)=>JSON.stringify(a??null)===JSON.stringify(b??null)

/**
 * Only the keys that actually changed, paired with what they changed from.
 *
 * An absent key means "leave it alone" on the Unity side, so sending the whole
 * state on every edit would make every diff claim authority over fields the
 * session never touched — and a stale layer value would then quietly overwrite
 * a deliberate Unity-side change.
 */
export function stateDelta(cur?:EntityState,prior?:EntityState):{state?:EntityState;priorState?:EntityState}{
  const state:Record<string,unknown>={},priorState:Record<string,unknown>={}
  let n=0
  for(const k of STATE_KEYS){
    const c=(cur??{})[k]
    if(c===undefined)continue
    const p=(prior??{})[k]
    if(sameStateValue(c,p))continue
    state[k]=c
    priorState[k]=p===undefined?null:p
    n++
  }
  return n?{state:state as EntityState,priorState:priorState as EntityState}:{}
}

// ---------------------------------------------------------------- session

export function createSession(scene:SceneExport,palette:Palette):Session{
  return {
    scene,palette,
    diffCreatedAt:new Date().toISOString(),
    editable:scene.entries.filter(e=>e.editable&&e.prefabPath).map(e=>{
      const base=baselineState(e)
      return {
        id:e.id,
        name:e.name,
        prefabPath:e.prefabPath!,
        transform:cloneTransform(e.transform),
        priorTransform:cloneTransform(e.transform),
        state:{...base},
        priorState:{...base},
        isAdded:false,
        deleted:false,
      }
    }),
  }
}

export function buildDiff(s:Session,createdAt=s.diffCreatedAt):Diff{
  const modified=s.editable
    .filter(e=>!e.isAdded&&!e.deleted&&e.priorTransform)
    .map(e=>({e,d:stateDelta(e.state,e.priorState)}))
    // A state-only change is still a change. Gating modified[] on the
    // transform alone dropped reparents and layer edits on the floor.
    .filter(({e,d})=>!sameTransform(e.transform,e.priorTransform!)||d.state!==undefined)
    .map(({e,d})=>({
      id:e.id,
      transform:normalizeTransform(e.transform),
      priorTransform:normalizeTransform(e.priorTransform!),
      ...d,
    }))

  // No priorState on an add — a new object has nothing to conflict with — so
  // send only the keys it actually carries.
  const added=s.editable.filter(e=>e.isAdded&&!e.deleted).map(e=>{
    const d=stateDelta(e.state,undefined)
    return {tempId:e.id,prefabPath:e.prefabPath,transform:normalizeTransform(e.transform),...(d.state?{state:d.state}:{})}
  })

  return {
    schemaVersion:'1.1.0',
    kind:'holocity.placement-diff',
    sceneName:s.scene.sceneName,
    baseHash:s.scene.baseHash,
    createdAt,
    modified,
    added,
    deleted:s.editable.filter(e=>!e.isAdded&&e.deleted&&e.priorTransform).map(e=>({id:e.id,priorTransform:normalizeTransform(e.priorTransform!)})),
  }
}

export function addItem(s:Session,item:Palette['items'][number],n:number,position:[number,number,number]=[0,0,0]):EditableItem{
  return {
    id:`add-${String(n).padStart(3,'0')}`,
    name:item.displayName,
    prefabPath:item.prefabPath,
    // ABSOLUTE from here on: seeded with the prefab's axis fix and stored as
    // the total. The importer assigns it rather than composing again.
    transform:{position,rotation:item.defaultRotation??[0,0,0,1],scale:item.defaultScale??[1,1,1]},
    isAdded:true,
    deleted:false,
  }
}

export const exportJson=(name:string,value:unknown)=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}
