import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * LLM output is frequently imperfect markdown: fences left unclosed
 * mid-stream, stray bold markers, headings glued to the previous
 * paragraph. Normalize the worst of it so rendering degrades gracefully
 * instead of swallowing half the message.
 */
function normalizeLlmMarkdown(text: string, streaming: boolean): string {
  let result = text;

  // Headings need a leading blank line to terminate the previous
  // paragraph; models often omit it.
  result = result.replace(/([^\n])\n(#{1,6} )/g, "$1\n\n$2");

  // An odd number of ``` fences means the last one is unclosed. While
  // streaming this is expected (close it so the tail still renders as
  // code); in a finished message the fence was a mistake.
  const fenceCount = (result.match(/^[ \t]*```/gm) ?? []).length;
  if (fenceCount % 2 === 1) {
    if (streaming) {
      result += "\n```";
    } else {
      result = result.replace(/^[ \t]*```[^\n]*$(?![\s\S]*^[ \t]*```)/m, "");
    }
  }

  return result;
}

export const MessageMarkdown = memo(function MessageMarkdown({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {normalizeLlmMarkdown(text, streaming)}
      </ReactMarkdown>
    </div>
  );
});
