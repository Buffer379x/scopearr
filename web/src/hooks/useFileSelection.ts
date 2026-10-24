import { useState } from "preact/hooks";
import type { FileKey } from "../types";
import { mergeSelection, pageSelection, visibleGroupKeys } from "../file-selection";
export { fileKey, groupSelected } from "../file-selection";
export function useFileSelection(scope: string, visible: FileKey[]) {
 const [saved, setSaved] = useState<{scope: string; values: Record<string, FileKey>}>({scope, values:{}});
 const selected = pageSelection(saved, scope, visible);
 const toggle = (keys: FileKey[], checked: boolean) => setSaved(current => ({scope, values:mergeSelection(pageSelection(current, scope, visible), keys, checked)}));
 return { selected, keys:Object.values(selected), busy:false, toggle,
  group:(service:string, mediaId:number, season:number|undefined, checked:boolean) => toggle(visibleGroupKeys(visible, service, mediaId, season), checked),
  clear:() => setSaved({scope,values:{}}),
 };
}
