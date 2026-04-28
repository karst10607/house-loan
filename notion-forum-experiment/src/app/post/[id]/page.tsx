import { getPostDetails, getComments } from "@/lib/notion";
import { NotionRenderer } from "@/components/NotionRenderer";
import { ArrowLeft, Clock, User, MessageCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { submitComment } from "@/app/actions";
import { FormSubmitButton } from "@/components/FormSubmitButton";

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await getPostDetails(id);
  
  if (!post) {
    notFound();
  }

  const comments = await getComments(id);

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-8 pb-20">
      <Link href="/" className="flex items-center gap-2 text-muted hover:text-accent transition-colors w-fit">
        <ArrowLeft size={16} />
        <span className="text-sm font-medium">Back to Discussions</span>
      </Link>

      {/* Post Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {post.tags.map(tag => (
            <span key={tag} className="px-2.5 py-1 rounded-md bg-accent/10 text-accent text-xs font-medium">
              #{tag}
            </span>
          ))}
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-foreground leading-tight">
          {post.title}
        </h1>
        <div className="flex items-center gap-4 text-sm text-muted border-b border-border pb-6 mt-2">
          <div className="flex items-center gap-1.5">
            <User size={16} />
            <span>{post.author}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock size={16} />
            <span>{new Date(post.createdAt).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Post Content */}
      <div className="min-h-[200px]">
        <NotionRenderer blocks={post.blocks} />
      </div>

      {/* Comments Section */}
      <div className="flex flex-col gap-6 mt-8 pt-8 border-t border-border">
        <div className="flex items-center gap-2 text-xl font-semibold">
          <MessageCircle size={24} className="text-accent" />
          <h2>Comments ({comments.length})</h2>
        </div>

        {/* Comment List */}
        <div className="flex flex-col gap-4">
          {comments.length === 0 ? (
            <div className="bg-surface border border-border rounded-xl p-8 text-center text-muted italic">
              No comments yet. Be the first to share your thoughts!
            </div>
          ) : (
            comments.map(comment => (
              <div key={comment.id} className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-3">
                <div className="flex justify-between items-center text-sm">
                  <div className="font-semibold text-foreground flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-teal to-accent flex items-center justify-center text-white text-[10px]">
                      {comment.author.charAt(0).toUpperCase()}
                    </div>
                    {comment.author}
                  </div>
                  <div className="text-muted text-xs">
                    {new Date(comment.createdAt).toLocaleString()}
                  </div>
                </div>
                <div className="text-foreground/90 whitespace-pre-wrap pl-8">
                  {comment.content}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Add Comment Form */}
        <div className="bg-surface-elevated border border-border rounded-xl p-5 mt-4 shadow-lg shadow-black/20">
          <h3 className="text-lg font-medium mb-4">Leave a Reply</h3>
          <form action={submitComment} className="flex flex-col gap-4">
            <input type="hidden" name="postId" value={post.id} />
            
            <div>
              <label htmlFor="author" className="block text-sm font-medium text-muted mb-1">Your Name</label>
              <input 
                type="text" 
                id="author" 
                name="author" 
                required 
                className="w-full bg-background border border-border rounded-lg px-4 py-2 text-foreground focus:outline-none focus:border-accent transition-colors"
                placeholder="Anonymous"
              />
            </div>
            
            <div>
              <label htmlFor="content" className="block text-sm font-medium text-muted mb-1">Message</label>
              <textarea 
                id="content" 
                name="content" 
                required 
                rows={4}
                className="w-full bg-background border border-border rounded-lg px-4 py-2 text-foreground focus:outline-none focus:border-accent transition-colors resize-y"
                placeholder="What do you think?"
              />
            </div>

            <div className="flex justify-end pt-2">
              <FormSubmitButton label="Post Comment" />
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
