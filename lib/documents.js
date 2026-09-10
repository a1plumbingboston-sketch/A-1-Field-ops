import fs from 'node:fs';
import crypto from 'node:crypto';
import {db,rpc} from './db.js';
import '../document-system.js';
export const D=globalThis.A1Documents;
const css=fs.readFileSync(new URL('../document-system.css',import.meta.url),'utf8');
const logo='data:image/png;base64,'+fs.readFileSync(new URL('../a1-logo.png',import.meta.url)).toString('base64');
export async function prepare(kind,id){const data=await rpc('fieldops_document_data',{p_kind:kind,p_id:id});const snapshot={...data,terms:D.terms,authorization:D.authorization(kind),template_version:31,css,logo};snapshot.html=D.render(snapshot,{logo,signatureSlot:'<div id="signature-slot"></div>'});return snapshot;}
export async function start(kind,id){return rpc('fieldops_start_document',{p_kind:kind,p_id:id,p_token:crypto.randomBytes(32).toString('base64url'),p_snapshot:await prepare(kind,id)});}
export async function session(token){return (await db(`fieldops_documents?token=eq.${encodeURIComponent(token)}&select=*`))?.[0];}
export function usable(s){if(!s)throw new Error('Signing request not found');if(!s.signed_at&&(s.superseded_at||new Date(s.expires_at)<new Date()))throw new Error('This signing link expired or was replaced. Request a new copy.');}
