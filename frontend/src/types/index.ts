export type ElementType = 'text'|'image'|'logo'|'vector'|'barcode'
<<<<<<< HEAD
export type ActionType  = 'replace'|'delete'|'move'|'resize'|'bold'
=======
export type ActionType  = 'replace'|'delete'|'move'|'resize'
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
export interface Project { id:string;name:string;sku:string;market:string;brand?:string;component?:string;created_by:string;created_at:string }
export interface Artwork { id:string;project_id:string;filename:string;total_pages:number;page_width_pts?:number;page_height_pts?:number;uploaded_at:string }
export interface PagePreview { preview_url:string;width_px:number;height_px:number;width_pts:number;height_pts:number;scale_factor:number;dpi:number;page_number:number }
export interface ArtElement { id:string;elem_id:string;type:ElementType;label:string;font_name?:string;font_size?:number;color?:string;x_norm:number;y_norm:number;w_norm:number;h_norm:number;x_pts:number;y_pts:number;w_pts:number;h_pts:number;page:number;allowed_actions:ActionType[] }
<<<<<<< HEAD
export interface BriefingAction { id:string;artwork_id:string;page:number;action_type:ActionType;status:string;element_id?:string;element_type?:string;original_text?:string;new_text?:string;new_font_size?:number;dx_mm?:number;dy_mm?:number;sel_x?:number;sel_y?:number;sel_w?:number;sel_h?:number;bold?:boolean;comment?:string;created_at:string }
export interface ActionCreatePayload { artwork_id:string;page:number;action_type:ActionType;element_id?:string;element_type?:string;original_text?:string;new_text?:string;new_font_size?:number;dx_mm?:number;dy_mm?:number;sel_x?:number;sel_y?:number;sel_w?:number;sel_h?:number;bold?:boolean;comment?:string }
=======
export interface BriefingAction { id:string;artwork_id:string;page:number;action_type:ActionType;status:string;element_id?:string;element_type?:string;original_text?:string;new_text?:string;new_font_size?:number;dx_mm?:number;dy_mm?:number;sel_x?:number;sel_y?:number;sel_w?:number;sel_h?:number;comment?:string;created_at:string }
export interface ActionCreatePayload { artwork_id:string;page:number;action_type:ActionType;element_id?:string;element_type?:string;original_text?:string;new_text?:string;new_font_size?:number;dx_mm?:number;dy_mm?:number;sel_x?:number;sel_y?:number;sel_w?:number;sel_h?:number;comment?:string }
>>>>>>> 61d4c81d2bf2ab0e66bb8907967f54fff7f0da6e
export interface DraftResult { draft_url:string;actions_applied:number;actions_failed:number;total_actions:number;briefing:any }
export interface Selection { x:number;y:number;w:number;h:number;x_px:number;y_px:number;w_px:number;h_px:number }
