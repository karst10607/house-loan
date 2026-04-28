"use client";

import { useState } from "react";
import { X, Plus } from "lucide-react";
import { submitPost } from "@/app/actions";
import { FormSubmitButton } from "@/components/FormSubmitButton";

export function NewPostModal() {
  const [isOpen, setIsOpen] = useState(false);

  // Note: Since we're using Server Actions, form submission will refresh the route state automatically
  // But we still need to close the modal. We can intercept the action.
  
  const handleAction = async (formData: FormData) => {
    const result = await submitPost(formData);
    if (result.success) {
      setIsOpen(false);
    } else {
      alert(result.error);
    }
  };

  return (
    <>
      <button 
        onClick={() => setIsOpen(true)}
        className="bg-accent text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors flex items-center gap-2"
      >
        <Plus size={16} />
        New Post
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-surface border border-border w-full max-w-2xl rounded-2xl shadow-2xl shadow-black/50 overflow-hidden flex flex-col max-h-[90vh]">
            
            <div className="flex items-center justify-between p-6 border-b border-white/5">
              <h2 className="text-xl font-bold text-foreground">Create a New Discussion</h2>
              <button 
                onClick={() => setIsOpen(false)}
                className="text-muted hover:text-foreground transition-colors p-1 rounded-md hover:bg-white/5"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto">
              <form action={handleAction} className="flex flex-col gap-5">
                <div>
                  <label htmlFor="title" className="block text-sm font-medium text-muted mb-1.5">Title</label>
                  <input 
                    type="text" 
                    id="title" 
                    name="title" 
                    required 
                    autoFocus
                    className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-all"
                    placeholder="What do you want to discuss?"
                  />
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label htmlFor="author" className="block text-sm font-medium text-muted mb-1.5">Your Name</label>
                    <input 
                      type="text" 
                      id="author" 
                      name="author" 
                      required 
                      className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-all"
                      placeholder="Anonymous"
                    />
                  </div>
                  <div>
                    <label htmlFor="tags" className="block text-sm font-medium text-muted mb-1.5">Tags (comma separated)</label>
                    <input 
                      type="text" 
                      id="tags" 
                      name="tags" 
                      className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-foreground focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-all"
                      placeholder="e.g. Question, Help, News"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="content" className="block text-sm font-medium text-muted mb-1.5">Details</label>
                  <textarea 
                    id="content" 
                    name="content" 
                    required 
                    rows={6}
                    className="w-full bg-background border border-border rounded-lg px-4 py-3 text-foreground focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-all resize-y"
                    placeholder="Provide more details here..."
                  />
                </div>

                <div className="flex justify-end pt-4 mt-2 border-t border-white/5 gap-3">
                  <button 
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="px-5 py-2.5 rounded-lg text-sm font-medium text-muted hover:text-foreground hover:bg-white/5 transition-colors"
                  >
                    Cancel
                  </button>
                  <FormSubmitButton label="Publish Post" />
                </div>
              </form>
            </div>
            
          </div>
        </div>
      )}
    </>
  );
}
