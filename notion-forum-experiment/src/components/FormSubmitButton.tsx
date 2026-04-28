"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

export function FormSubmitButton({ label = "Submit", className = "" }: { label?: string, className?: string }) {
  const { pending } = useFormStatus();

  return (
    <button 
      type="submit" 
      disabled={pending}
      className={`bg-accent text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-accent/90 transition-all flex items-center justify-center min-w-[120px] disabled:opacity-70 disabled:cursor-not-allowed ${className}`}
    >
      {pending ? (
        <>
          <Loader2 size={16} className="mr-2 animate-spin" />
          Sending...
        </>
      ) : (
        label
      )}
    </button>
  );
}
