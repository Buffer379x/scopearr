import type { MediaFile } from "../types";
import { channelRows } from "../audio-channels";
import { Tag } from "./Tag";
export function ChannelsCell({ file }: { file: MediaFile }) {
  return (
    <div
      class={file.audioTracks?.length ? "track-language-list" : "source-tags"}
    >
      {channelRows(file).map((value, index) => (
        <div key={index}>
          <Tag respectHidden kind="channels" value={value} />
        </div>
      ))}
    </div>
  );
}
