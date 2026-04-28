import { BlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";

export function NotionRenderer({ blocks }: { blocks: BlockObjectResponse[] }) {
  if (!blocks || blocks.length === 0) {
    return <div className="text-muted italic">No content.</div>;
  }

  return (
    <div className="flex flex-col gap-4 text-foreground leading-relaxed">
      {blocks.map((block) => {
        switch (block.type) {
          case "paragraph":
            return (
              <p key={block.id}>
                {block.paragraph.rich_text.map((text, i) => (
                  <span
                    key={i}
                    className={`
                      ${text.annotations.bold ? "font-bold" : ""}
                      ${text.annotations.italic ? "italic" : ""}
                      ${text.annotations.strikethrough ? "line-through" : ""}
                      ${text.annotations.underline ? "underline" : ""}
                      ${text.annotations.code ? "font-mono bg-accent/10 text-accent px-1 py-0.5 rounded text-sm" : ""}
                    `}
                  >
                    {text.plain_text}
                  </span>
                ))}
              </p>
            );
            
          case "heading_1":
            return <h1 key={block.id} className="text-3xl font-bold mt-6 mb-2">{block.heading_1.rich_text[0]?.plain_text}</h1>;
          case "heading_2":
            return <h2 key={block.id} className="text-2xl font-bold mt-5 mb-2">{block.heading_2.rich_text[0]?.plain_text}</h2>;
          case "heading_3":
            return <h3 key={block.id} className="text-xl font-bold mt-4 mb-2">{block.heading_3.rich_text[0]?.plain_text}</h3>;
            
          case "bulleted_list_item":
            return (
              <li key={block.id} className="ml-6 list-disc">
                {block.bulleted_list_item.rich_text.map(t => t.plain_text).join("")}
              </li>
            );
            
          case "numbered_list_item":
            return (
              <li key={block.id} className="ml-6 list-decimal">
                {block.numbered_list_item.rich_text.map(t => t.plain_text).join("")}
              </li>
            );
            
          case "code":
            return (
              <pre key={block.id} className="bg-surface-elevated p-4 rounded-xl border border-border overflow-x-auto text-sm font-mono mt-2 mb-2">
                <code className="text-accent/90">{block.code.rich_text[0]?.plain_text}</code>
              </pre>
            );

          case "quote":
            return (
              <blockquote key={block.id} className="border-l-4 border-accent pl-4 py-1 my-2 text-muted italic">
                {block.quote.rich_text.map(t => t.plain_text).join("")}
              </blockquote>
            );

          default:
            return <div key={block.id} className="text-xs text-muted/50">[Unsupported block type: {block.type}]</div>;
        }
      })}
    </div>
  );
}
