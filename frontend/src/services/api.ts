import type { Project,Artwork,PagePreview,ArtElement,BriefingAction,ActionCreatePayload,DraftResult } from '../types'
const BASE='/api/v1'
async function req<T>(path:string,opts:RequestInit={}):Promise<T>{
  const r=await fetch(`${BASE}${path}`,{headers:{'Content-Type':'application/json',...opts.headers},...opts})
  if(!r.ok){const e=await r.json().catch(()=>({detail:r.statusText}));throw new Error(e.detail||'API error')}
  return r.json()
}
export const api={
  listProjects:()=>req<Project[]>('/projects/'),
  createProject:(d:any)=>req<Project>('/projects/',{method:'POST',body:JSON.stringify(d)}),
  uploadArtwork:async(projectId:string,file:File):Promise<Artwork>=>{
    const fd=new FormData();fd.append('project_id',projectId);fd.append('uploaded_by','user');fd.append('file',file)
    const r=await fetch(`${BASE}/artworks/upload/`,{method:'POST',body:fd})
    if(!r.ok)throw new Error('Upload failed')
    return r.json()
  },
  getPage:(id:string,page:number,dpi=150)=>req<PagePreview>(`/artworks/${id}/pages/${page}?dpi=${dpi}`),
  getElements:(id:string,page:number)=>req<ArtElement[]>(`/artworks/${id}/elements/${page}`),
  createAction:(d:ActionCreatePayload)=>req<BriefingAction>('/actions/',{method:'POST',body:JSON.stringify(d)}),
  listActions:(aid:string,page?:number)=>req<BriefingAction[]>(`/actions/artwork/${aid}${page!==undefined?`?page=${page}`:''}`,),
  deleteAction:(id:string)=>req<any>(`/actions/${id}`,{method:'DELETE'}),
  generateDraft:(aid:string,page:number,engine?:string)=>req<DraftResult>('/drafts/generate/',{method:'POST',body:JSON.stringify({artwork_id:aid,page,engine:engine??null})}),
}
