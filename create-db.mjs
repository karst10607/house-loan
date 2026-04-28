import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

// Parent page where we'll create the databases
const PARENT_PAGE_ID = "26660014-8c10-81d0-9e8b-c9afa954e05f"; // "to 張小弟"

async function main() {
  try {
    // 1. Create Posts Database
    const postsDb = await notion.databases.create({
      parent: { type: "page_id", page_id: PARENT_PAGE_ID },
      title: [{ type: "text", text: { content: "Forum Posts" } }],
      properties: {
        "Name": { title: {} },
        "Author": { rich_text: {} },
        "Tags": { multi_select: { options: [] } },
        "Created At": { created_time: {} },
      },
    });
    
    console.log("POSTS_DB_ID=" + postsDb.id);

    // 2. Create Comments Database
    const commentsDb = await notion.databases.create({
      parent: { type: "page_id", page_id: PARENT_PAGE_ID },
      title: [{ type: "text", text: { content: "Forum Comments" } }],
      properties: {
        "Name": { title: {} },
        "Post": { 
          relation: { 
            database_id: postsDb.id,
            type: "single_property"
          } 
        },
        "Author": { rich_text: {} },
        "Content": { rich_text: {} },
        "Created At": { created_time: {} },
      },
    });

    console.log("COMMENTS_DB_ID=" + commentsDb.id);
  } catch (error) {
    console.error("Error creating databases:", error);
  }
}

main();
