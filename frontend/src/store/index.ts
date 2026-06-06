import{create}from 'zustand'
import type{Project,Artwork,PagePreview,ArtElement,BriefingAction,Selection}from '../types'
interface S{
  project:Project|null;artwork:Artwork|null;page:number;pagePreview:PagePreview|null
  elements:ArtElement[];actions:BriefingAction[]
  selection:Selection|null;hoveredElem:ArtElement|null;selectedElem:ArtElement|null
  activeTool:'select'|'region';draftUrl:string|null;loading:boolean;error:string|null
  setProject:(p:Project|null)=>void;setArtwork:(a:Artwork|null)=>void
  setPage:(p:number)=>void;setPagePreview:(p:PagePreview|null)=>void
  setElements:(e:ArtElement[])=>void;addAction:(a:BriefingAction)=>void
  removeAction:(id:string)=>void;setActions:(a:BriefingAction[])=>void
  setSelection:(s:Selection|null)=>void;setHoveredElem:(e:ArtElement|null)=>void
  setSelectedElem:(e:ArtElement|null)=>void;setActiveTool:(t:'select'|'region')=>void
  setDraftUrl:(u:string|null)=>void;setLoading:(v:boolean)=>void;setError:(e:string|null)=>void
}
export const useStore=create<S>((set)=>({
  project:null,artwork:null,page:0,pagePreview:null,elements:[],actions:[],
  selection:null,hoveredElem:null,selectedElem:null,activeTool:'select',
  draftUrl:null,loading:false,error:null,
  setProject:(project)=>set({project}),setArtwork:(artwork)=>set({artwork}),
  setPage:(page)=>set({page}),setPagePreview:(pagePreview)=>set({pagePreview}),
  setElements:(elements)=>set({elements}),
  addAction:(action)=>set(s=>({actions:[...s.actions,action]})),
  removeAction:(id)=>set(s=>({actions:s.actions.filter(a=>a.id!==id)})),
  setActions:(actions)=>set({actions}),setSelection:(selection)=>set({selection}),
  setHoveredElem:(hoveredElem)=>set({hoveredElem}),
  setSelectedElem:(selectedElem)=>set({selectedElem}),
  setActiveTool:(activeTool)=>set({activeTool}),
  setDraftUrl:(draftUrl)=>set({draftUrl}),
  setLoading:(loading)=>set({loading}),setError:(error)=>set({error}),
}))
