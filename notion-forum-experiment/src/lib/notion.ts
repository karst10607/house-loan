import { Client } from "@notionhq/client";
import { BlockObjectResponse } from "@notionhq/client/build/src/api-endpoints";

// Create a Notion client instance. 
// Using a simpler export to avoid HMR issues seen with some versions of Next.js Turbopack.
export const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

// Database IDs
export const POSTS_DB_ID = process.env.NOTION_POSTS_DATABASE_ID || "";
export const COMMENTS_DB_ID = process.env.NOTION_COMMENTS_DATABASE_ID || "";

// Types
export interface Post {
  id: string;
  title: string;
  createdAt: string;
  author: string;
  tags: string[];
}

export interface PostDetail extends Post {
  blocks: BlockObjectResponse[];
}

export interface Comment {
  id: string;
  postId: string; // Relation to Post
  content: string;
  author: string;
  createdAt: string;
}

// Basic API wrappers (can be expanded later)
// Helper for direct API calls since the SDK query method is missing in this environment
async function notionRequest(path: string, method: string, body?: any) {
  const response = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${process.env.NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Notion API error: ${response.status} - ${error}`);
  }
  
  return response.json();
}

// Basic API wrappers
export async function getPosts(): Promise<Post[]> {
  if (!POSTS_DB_ID) return [];

  try {
    const response = await notionRequest(`databases/${POSTS_DB_ID}/query`, "POST", {
      sorts: [
        {
          property: "Created At",
          direction: "descending",
        },
      ],
    });

    return response.results.map((page: any) => {
      return {
        id: page.id,
        title: page.properties.Name?.title?.[0]?.plain_text || "Untitled",
        createdAt: page.properties["Created At"]?.created_time || page.created_time,
        author: page.properties.Author?.rich_text?.[0]?.plain_text || "Unknown",
        tags: page.properties.Tags?.multi_select?.map((t: any) => t.name) || [],
      };
    });
  } catch (error) {
    console.error("Error fetching posts:", error);
    return [];
  }
}

export async function getPostDetails(id: string): Promise<PostDetail | null> {
  if (!POSTS_DB_ID) return null;

  try {
    // For retrieve/list, we can still try to use the SDK if they exist, but fetch is safer now
    const page: any = await notionRequest(`pages/${id}`, "GET");
    const blocksResponse = await notionRequest(`blocks/${id}/children`, "GET");
    
    return {
      id: page.id,
      title: page.properties.Name?.title?.[0]?.plain_text || "Untitled",
      createdAt: page.properties["Created At"]?.created_time || page.created_time,
      author: page.properties.Author?.rich_text?.[0]?.plain_text || "Unknown",
      tags: page.properties.Tags?.multi_select?.map((t: any) => t.name) || [],
      blocks: blocksResponse.results as BlockObjectResponse[],
    };
  } catch (error) {
    console.error("Error fetching post details:", error);
    return null;
  }
}

export async function createPost(title: string, content: string, author: string, tags: string[]): Promise<string | null> {
  if (!POSTS_DB_ID) return null;

  try {
    const response = await notionRequest("pages", "POST", {
      parent: { database_id: POSTS_DB_ID },
      properties: {
        Name: { title: [{ text: { content: title } }] },
        Author: { rich_text: [{ text: { content: author } }] },
        Tags: { multi_select: tags.map(tag => ({ name: tag })) },
      },
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [{ type: "text", text: { content: content } }]
          }
        }
      ]
    });
    return response.id;
  } catch (error) {
    console.error("Error creating post:", error);
    return null;
  }
}

export async function getComments(postId: string): Promise<Comment[]> {
  if (!COMMENTS_DB_ID) return [];

  try {
    const response = await notionRequest(`databases/${COMMENTS_DB_ID}/query`, "POST", {
      filter: {
        property: "Post",
        relation: {
          contains: postId
        }
      },
      sorts: [
        {
          property: "Created At",
          direction: "ascending",
        },
      ],
    });

    return response.results.map((page: any) => {
      return {
        id: page.id,
        postId: postId,
        content: page.properties.Content?.rich_text?.[0]?.plain_text || "",
        author: page.properties.Author?.rich_text?.[0]?.plain_text || "Unknown",
        createdAt: page.properties["Created At"]?.created_time || page.created_time,
      };
    });
  } catch (error) {
    console.error("Error fetching comments:", error);
    return [];
  }
}

export async function createComment(postId: string, content: string, author: string): Promise<string | null> {
  if (!COMMENTS_DB_ID) return null;

  try {
    const response = await notionRequest("pages", "POST", {
      parent: { database_id: COMMENTS_DB_ID },
      properties: {
        Name: { title: [{ text: { content: `Comment by ${author}` } }] },
        Post: { relation: [{ id: postId }] },
        Author: { rich_text: [{ text: { content: author } }] },
        Content: { rich_text: [{ text: { content: content } }] },
      }
    });
    return response.id;
  } catch (error) {
    console.error("Error creating comment:", error);
    return null;
  }
}
