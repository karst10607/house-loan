"use server";

import { createPost, createComment } from "@/lib/notion";
import { revalidatePath } from "next/cache";

export async function submitPost(formData: FormData) {
  const title = formData.get("title") as string;
  const author = formData.get("author") as string;
  const content = formData.get("content") as string;
  const tagsStr = formData.get("tags") as string;

  if (!title || !author || !content) {
    return { error: "Title, author, and content are required." };
  }

  const tags = tagsStr ? tagsStr.split(",").map(t => t.trim()).filter(Boolean) : ["General"];

  const id = await createPost(title, content, author, tags);
  
  if (id) {
    revalidatePath("/");
    return { success: true, id };
  } else {
    return { error: "Failed to create post. Please check your Notion configuration." };
  }
}

export async function submitComment(formData: FormData) {
  const postId = formData.get("postId") as string;
  const author = formData.get("author") as string;
  const content = formData.get("content") as string;

  if (!postId || !author || !content) {
    return { error: "Author and content are required." };
  }

  const id = await createComment(postId, content, author);
  
  if (id) {
    revalidatePath(`/post/${postId}`);
    return { success: true };
  } else {
    return { error: "Failed to create comment." };
  }
}
