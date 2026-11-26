// The editor and the replay player must use the exact same document schema,
// otherwise recorded steps cannot be re-applied. Keep this the single source.
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

export const schemaExtensions = [
  StarterKit.configure({
    // Links are opened in the editor by accident far too often while drafting.
    link: { openOnClick: false },
  }),
];

let cached: ReturnType<typeof getSchema> | null = null;
export function getDocSchema() {
  if (!cached) cached = getSchema(schemaExtensions);
  return cached;
}
