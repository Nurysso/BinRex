// components/HelpDialog.tsx
import React, { useState, useEffect } from 'react';
import { marked } from 'marked';
import { X, BookOpen } from 'lucide-react';

interface HelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
  isDark?: boolean;
}

export default function HelpDialog({ isOpen, onClose, isDark = false }: HelpDialogProps) {
  const [htmlContent, setHtmlContent] = useState('');

  useEffect(() => {
    if (isOpen) {
      fetch('Public/docs/config.md')
        .then(res => res.text())
        .then(async text => {
          const html = await marked.parse(text, {
            breaks: true,
            gfm: true,
          });
          setHtmlContent(html);
        })
        .catch(err => console.error('Failed to load help:', err));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className={`w-full max-w-4xl max-h-[90vh] ${isDark ? 'bg-gray-900' : 'bg-white'} rounded-2xl shadow-2xl flex flex-col`}>
        {/* Header */}
        <div className={`flex items-center justify-between p-6 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
              <BookOpen size={20} className="text-white" />
            </div>
            <div>
              <h2 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Configuration Guide
              </h2>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Learn how to configure Poto Media Scanner
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-2 rounded-lg ${isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-100'} transition-colors`}
          >
            <X size={20} className={isDark ? 'text-gray-400' : 'text-gray-600'} />
          </button>
        </div>

        {/* Content */}
        <div className={`flex-1 overflow-y-auto p-8`}>
          <div
            className={`prose max-w-none ${isDark ? 'prose-invert' : ''}`}
            dangerouslySetInnerHTML={{ __html: htmlContent }}
          />
        </div>
      </div>
    </div>
  );
}
