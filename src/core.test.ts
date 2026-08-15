import {describe,expect,it} from 'vitest'
import {addItem,buildDiff,createSession,stateDelta,threeToUnity,unityToThree} from './core'
import type {Palette,SceneExport,Transform} from './types'

const t:Transform={position:[1,2,3],rotation:[0,0,0,1],scale:[1,1,1]}
const scene:SceneExport={
  schemaVersion:'1.1.0',kind:'holocity.scene-export',sceneName:'Test',
  unityScenePath:'Assets/Test.unity',exportedAt:new Date().toISOString(),
  exportMode:'whole',baseHash:'abc',
  entries:[
    {id:'e1',name:'L',editable:true,prefabPath:'Assets/L.prefab',transform:t,
     parentId:'p1',state:{active:true,layer:'Buildings',tag:'Untagged',staticFlags:[],materialVariant:null}},
    {id:'e2',name:'M',editable:true,prefabPath:'Assets/M.prefab',transform:t},
    {id:'locked',name:'Terrain',editable:false,transform:t},
  ],
}
const palette:Palette={schemaVersion:'1.1.0',kind:'holocity.palette',items:[
  {prefabPath:'Assets/L.prefab',displayName:'L',kitFamily:'Kit',glb:'glb/L.glb',
   defaultRotation:[0,Math.SQRT1_2,0,Math.SQRT1_2],
   materialVariants:[{key:'dusk',displayName:'Dusk'}]},
]}
const AT='2026-01-01T00:00:00.000Z'

describe('contract safety',()=>{
  it('untouched is empty',()=>{
    const d=buildDiff(createSession(scene,palette),AT)
    expect(d.modified).toEqual([]);expect(d.added).toEqual([]);expect(d.deleted).toEqual([])
  })
  it('coordinate conversion round trips',()=>expect(threeToUnity(unityToThree(t))).toEqual(t))
  it('+90 Unity Y survives conversion',()=>{
    const q=Math.SQRT1_2
    expect(threeToUnity(unityToThree({...t,rotation:[0,q,0,q]})).rotation).toEqual([0,q,0,q])
  })
  it('locked objects are absent from edit state',()=>
    expect(createSession(scene,palette).editable.map(x=>x.id)).toEqual(['e1','e2']))
})

describe('state delta',()=>{
  it('emits only changed keys, each with its prior',()=>{
    const d=stateDelta({active:false,layer:'Buildings'},{active:true,layer:'Buildings'})
    expect(d.state).toEqual({active:false})
    expect(d.priorState).toEqual({active:true})
  })
  it('an absent key means leave it alone, not reset it',()=>{
    // The importer applies exactly the keys present. If an untouched key were
    // emitted anyway, a stale session would overwrite a deliberate Unity edit.
    expect(stateDelta({active:false},{active:true,layer:'Buildings'}).state).toEqual({active:false})
  })
  it('no change produces no state at all',()=>
    expect(stateDelta({layer:'Buildings'},{layer:'Buildings'})).toEqual({}))
  it('array flags compare by value, not identity',()=>
    expect(stateDelta({staticFlags:['BatchingStatic']},{staticFlags:['BatchingStatic']})).toEqual({}))
})

describe('widened diff',()=>{
  it('a state-only change still reaches modified[]',()=>{
    // Regression: modified[] used to be gated on the transform alone, which
    // dropped reparents and layer edits on the floor.
    const s=createSession(scene,palette)
    s.editable[0].state!.layer='Props'
    const d=buildDiff(s,AT)
    expect(d.modified).toHaveLength(1)
    expect(d.modified[0].state).toEqual({layer:'Props'})
    expect(d.modified[0].priorState).toEqual({layer:'Buildings'})
    expect(d.modified[0].transform).toEqual(d.modified[0].priorTransform)
  })
  it('reparent carries parentId and its prior; null means scene root',()=>{
    const s=createSession(scene,palette)
    s.editable[0].state!.parentId=null
    const d=buildDiff(s,AT)
    expect(d.modified[0].state).toEqual({parentId:null})
    expect(d.modified[0].priorState).toEqual({parentId:'p1'})
  })
  it('an entry the export gave no state to still gets a full baseline',()=>{
    // e2 has no `state`. Without a baseline there is nothing to conflict-check
    // against, and the change would have to be trusted blind.
    const s=createSession(scene,palette)
    expect(s.editable[1].priorState).toEqual(
      {parentId:null,active:true,layer:'Default',tag:'Untagged',staticFlags:[],materialVariant:null})
  })
  it('added items carry no priorState',()=>{
    const s=createSession(scene,palette)
    const item=addItem(s,palette.items[0],1,[5,0,5])
    item.state={materialVariant:'dusk'}
    s.editable.push(item)
    const d=buildDiff(s,AT)
    expect(d.added).toHaveLength(1)
    expect(d.added[0].state).toEqual({materialVariant:'dusk'})
    expect(d.added[0]).not.toHaveProperty('priorState')
  })
  it('an added item stores the absolute rotation, axis fix included',()=>{
    // The importer ASSIGNS this. If it were a delta, composing on the Unity
    // side would apply the axis fix twice — which 1.0.0 did.
    const s=createSession(scene,palette)
    expect(addItem(s,palette.items[0],1).transform.rotation)
      .toEqual([0,Math.SQRT1_2,0,Math.SQRT1_2])
  })
})
