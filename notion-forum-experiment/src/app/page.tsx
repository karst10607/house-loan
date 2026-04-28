import { getPosts } from "@/lib/notion";
import { Clock, Hash, ChevronRight } from "lucide-react";
import Link from "next/link";
import { NewPostModal } from "@/components/NewPostModal";

export default async function Home() {
  const posts = await getPosts();

  return (
    <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-6 items-start">
      {/* Sidebar / Filters */}
      <aside className="bg-surface border border-border rounded-xl p-4 flex flex-col gap-4 sticky top-20">
        <div className="text-sm font-semibold text-muted uppercase tracking-wider mb-2">Filters</div>
        <nav className="flex flex-col gap-1">
          <Link href="/" className="flex items-center justify-between px-3 py-2 bg-accent/10 text-accent rounded-lg text-sm font-medium transition-colors">
            <span>All Posts</span>
            <span className="bg-accent/20 px-2 py-0.5 rounded-full text-xs">{posts.length}</span>
          </Link>
          <Link href="/" className="flex items-center justify-between px-3 py-2 hover:bg-white/5 text-foreground rounded-lg text-sm font-medium transition-colors">
            <span>Discussions</span>
          </Link>
          <Link href="/" className="flex items-center justify-between px-3 py-2 hover:bg-white/5 text-foreground rounded-lg text-sm font-medium transition-colors">
            <span>Questions</span>
          </Link>
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between bg-surface border border-border rounded-xl p-4 shadow-sm">
          <h1 className="text-xl font-bold text-foreground">Latest Discussions</h1>
          <NewPostModal />
        </div>

        <div className="flex flex-col gap-3">
          {posts.length === 0 ? (
            <div className="bg-surface border border-border rounded-xl p-12 flex flex-col items-center justify-center gap-4 text-center text-muted">
              <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-2">
                <Hash size={32} className="text-accent/50" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-foreground mb-1">No posts found</h3>
                <p className="text-sm max-w-md mx-auto">
                  Please configure your Notion Database IDs in <code className="text-accent bg-accent/10 px-1 rounded">.env.local</code> and create your first post.
                </p>
              </div>
            </div>
          ) : (
            posts.map((post) => (
              <Link 
                key={post.id} 
                href={`/post/${post.id}`}
                className="group flex flex-col sm:flex-row sm:items-center gap-4 bg-surface border border-border rounded-xl p-5 hover:border-accent/50 hover:shadow-[0_0_15px_rgba(79,142,247,0.1)] transition-all"
              >
                <div className="flex-1 flex flex-col gap-2">
                  <h2 className="text-lg font-medium text-foreground group-hover:text-accent transition-colors line-clamp-1">
                    {post.title}
                  </h2>
                  <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
                    <span className="flex items-center gap-1.5">
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-teal to-accent flex items-center justify-center text-white font-bold text-[10px]">
                        {post.author.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium text-foreground/80">{post.author}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock size={14} />
                      {new Date(post.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between gap-2 mt-2 sm:mt-0">
                  <div className="flex gap-2">
                    {post.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-xs text-muted font-medium whitespace-nowrap">
                        <Hash size={12} className="text-accent" />
                        {tag}
                      </span>
                    ))}
                  </div>
                  <ChevronRight size={20} className="text-muted group-hover:text-accent group-hover:translate-x-1 transition-all" />
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
