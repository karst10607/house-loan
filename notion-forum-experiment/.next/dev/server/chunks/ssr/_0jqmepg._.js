module.exports = [
"[project]/src/lib/notion.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "COMMENTS_DB_ID",
    ()=>COMMENTS_DB_ID,
    "POSTS_DB_ID",
    ()=>POSTS_DB_ID,
    "createComment",
    ()=>createComment,
    "createPost",
    ()=>createPost,
    "getComments",
    ()=>getComments,
    "getPostDetails",
    ()=>getPostDetails,
    "getPosts",
    ()=>getPosts,
    "notion",
    ()=>notion
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$notionhq$2f$client$2f$build$2f$src$2f$index$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/@notionhq/client/build/src/index.js [app-rsc] (ecmascript)");
;
const notion = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$notionhq$2f$client$2f$build$2f$src$2f$index$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Client"]({
    auth: process.env.NOTION_TOKEN
});
const POSTS_DB_ID = process.env.NOTION_POSTS_DATABASE_ID || "";
const COMMENTS_DB_ID = process.env.NOTION_COMMENTS_DATABASE_ID || "";
// Basic API wrappers (can be expanded later)
// Helper for direct API calls since the SDK query method is missing in this environment
async function notionRequest(path, method, body) {
    const response = await fetch(`https://api.notion.com/v1/${path}`, {
        method,
        headers: {
            "Authorization": `Bearer ${process.env.NOTION_TOKEN}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Notion API error: ${response.status} - ${error}`);
    }
    return response.json();
}
async function getPosts() {
    if (!POSTS_DB_ID) return [];
    try {
        const response = await notionRequest(`databases/${POSTS_DB_ID}/query`, "POST", {
            sorts: [
                {
                    property: "Created At",
                    direction: "descending"
                }
            ]
        });
        return response.results.map((page)=>{
            return {
                id: page.id,
                title: page.properties.Name?.title?.[0]?.plain_text || "Untitled",
                createdAt: page.properties["Created At"]?.created_time || page.created_time,
                author: page.properties.Author?.rich_text?.[0]?.plain_text || "Unknown",
                tags: page.properties.Tags?.multi_select?.map((t)=>t.name) || []
            };
        });
    } catch (error) {
        console.error("Error fetching posts:", error);
        return [];
    }
}
async function getPostDetails(id) {
    if (!POSTS_DB_ID) return null;
    try {
        // For retrieve/list, we can still try to use the SDK if they exist, but fetch is safer now
        const page = await notionRequest(`pages/${id}`, "GET");
        const blocksResponse = await notionRequest(`blocks/${id}/children`, "GET");
        return {
            id: page.id,
            title: page.properties.Name?.title?.[0]?.plain_text || "Untitled",
            createdAt: page.properties["Created At"]?.created_time || page.created_time,
            author: page.properties.Author?.rich_text?.[0]?.plain_text || "Unknown",
            tags: page.properties.Tags?.multi_select?.map((t)=>t.name) || [],
            blocks: blocksResponse.results
        };
    } catch (error) {
        console.error("Error fetching post details:", error);
        return null;
    }
}
async function createPost(title, content, author, tags) {
    if (!POSTS_DB_ID) return null;
    try {
        const response = await notionRequest("pages", "POST", {
            parent: {
                database_id: POSTS_DB_ID
            },
            properties: {
                Name: {
                    title: [
                        {
                            text: {
                                content: title
                            }
                        }
                    ]
                },
                Author: {
                    rich_text: [
                        {
                            text: {
                                content: author
                            }
                        }
                    ]
                },
                Tags: {
                    multi_select: tags.map((tag)=>({
                            name: tag
                        }))
                }
            },
            children: [
                {
                    object: "block",
                    type: "paragraph",
                    paragraph: {
                        rich_text: [
                            {
                                type: "text",
                                text: {
                                    content: content
                                }
                            }
                        ]
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
async function getComments(postId) {
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
                    direction: "ascending"
                }
            ]
        });
        return response.results.map((page)=>{
            return {
                id: page.id,
                postId: postId,
                content: page.properties.Content?.rich_text?.[0]?.plain_text || "",
                author: page.properties.Author?.rich_text?.[0]?.plain_text || "Unknown",
                createdAt: page.properties["Created At"]?.created_time || page.created_time
            };
        });
    } catch (error) {
        console.error("Error fetching comments:", error);
        return [];
    }
}
async function createComment(postId, content, author) {
    if (!COMMENTS_DB_ID) return null;
    try {
        const response = await notionRequest("pages", "POST", {
            parent: {
                database_id: COMMENTS_DB_ID
            },
            properties: {
                Name: {
                    title: [
                        {
                            text: {
                                content: `Comment by ${author}`
                            }
                        }
                    ]
                },
                Post: {
                    relation: [
                        {
                            id: postId
                        }
                    ]
                },
                Author: {
                    rich_text: [
                        {
                            text: {
                                content: author
                            }
                        }
                    ]
                },
                Content: {
                    rich_text: [
                        {
                            text: {
                                content: content
                            }
                        }
                    ]
                }
            }
        });
        return response.id;
    } catch (error) {
        console.error("Error creating comment:", error);
        return null;
    }
}
}),
"[project]/src/app/actions.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/* __next_internal_action_entry_do_not_use__ [{"400ac6913a9aab835c4cb42d54d41253077b5d3042":{"name":"submitComment"},"40931aa7e2c1cc507e7708a421e569e553848d8785":{"name":"submitPost"}},"src/app/actions.ts",""] */ __turbopack_context__.s([
    "submitComment",
    ()=>submitComment,
    "submitPost",
    ()=>submitPost
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$build$2f$webpack$2f$loaders$2f$next$2d$flight$2d$loader$2f$server$2d$reference$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/build/webpack/loaders/next-flight-loader/server-reference.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$notion$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/lib/notion.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$cache$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/cache.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$build$2f$webpack$2f$loaders$2f$next$2d$flight$2d$loader$2f$action$2d$validate$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/build/webpack/loaders/next-flight-loader/action-validate.js [app-rsc] (ecmascript)");
;
;
;
async function submitPost(formData) {
    const title = formData.get("title");
    const author = formData.get("author");
    const content = formData.get("content");
    const tagsStr = formData.get("tags");
    if (!title || !author || !content) {
        return {
            error: "Title, author, and content are required."
        };
    }
    const tags = tagsStr ? tagsStr.split(",").map((t)=>t.trim()).filter(Boolean) : [
        "General"
    ];
    const id = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$notion$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["createPost"])(title, content, author, tags);
    if (id) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$cache$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["revalidatePath"])("/");
        return {
            success: true,
            id
        };
    } else {
        return {
            error: "Failed to create post. Please check your Notion configuration."
        };
    }
}
async function submitComment(formData) {
    const postId = formData.get("postId");
    const author = formData.get("author");
    const content = formData.get("content");
    if (!postId || !author || !content) {
        return {
            error: "Author and content are required."
        };
    }
    const id = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$lib$2f$notion$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["createComment"])(postId, content, author);
    if (id) {
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$cache$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["revalidatePath"])(`/post/${postId}`);
        return {
            success: true
        };
    } else {
        return {
            error: "Failed to create comment."
        };
    }
}
;
(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$build$2f$webpack$2f$loaders$2f$next$2d$flight$2d$loader$2f$action$2d$validate$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ensureServerEntryExports"])([
    submitPost,
    submitComment
]);
(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$build$2f$webpack$2f$loaders$2f$next$2d$flight$2d$loader$2f$server$2d$reference$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerServerReference"])(submitPost, "40931aa7e2c1cc507e7708a421e569e553848d8785", null);
(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$build$2f$webpack$2f$loaders$2f$next$2d$flight$2d$loader$2f$server$2d$reference$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerServerReference"])(submitComment, "400ac6913a9aab835c4cb42d54d41253077b5d3042", null);
}),
"[project]/.next-internal/server/app/page/actions.js { ACTIONS_MODULE0 => \"[project]/src/app/actions.ts [app-rsc] (ecmascript)\" } [app-rsc] (server actions loader, ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([]);
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$app$2f$actions$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/app/actions.ts [app-rsc] (ecmascript)");
;
}),
"[project]/.next-internal/server/app/page/actions.js { ACTIONS_MODULE0 => \"[project]/src/app/actions.ts [app-rsc] (ecmascript)\" } [app-rsc] (server actions loader, ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "40931aa7e2c1cc507e7708a421e569e553848d8785",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$src$2f$app$2f$actions$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["submitPost"]
]);
var __TURBOPACK__imported__module__$5b$project$5d2f2e$next$2d$internal$2f$server$2f$app$2f$page$2f$actions$2e$js__$7b$__ACTIONS_MODULE0__$3d3e$__$225b$project$5d2f$src$2f$app$2f$actions$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$2922$__$7d$__$5b$app$2d$rsc$5d$__$28$server__actions__loader$2c$__ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i('[project]/.next-internal/server/app/page/actions.js { ACTIONS_MODULE0 => "[project]/src/app/actions.ts [app-rsc] (ecmascript)" } [app-rsc] (server actions loader, ecmascript) <locals>');
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$app$2f$actions$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/app/actions.ts [app-rsc] (ecmascript)");
}),
];

//# sourceMappingURL=_0jqmepg._.js.map