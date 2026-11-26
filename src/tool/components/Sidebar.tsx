'use client';

import React from 'react';
import { RECORD_TYPES, RESOLVERS } from '../ui-shared';
import type { ToolState } from '../types';

interface SidebarProps {
  state: ToolState;
  onChange: (next: ToolState) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ state, onChange }) => {
  return (
    <div className="p-4 space-y-6 text-sm overflow-y-auto h-full" data-testid="dns-sidebar">
      <div>
        <h3 className="mb-2 font-medium text-gray-900 dark:text-gray-100">Record types</h3>
        <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-300">
          {RECORD_TYPES.map((rt) => (
            <li key={rt.value} className="flex justify-between gap-2">
              <span>{rt.label}</span>
              <span className="text-gray-500 dark:text-gray-400">{rt.hint}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-2 font-medium text-gray-900 dark:text-gray-100">Resolvers</h3>
        <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-300">
          {RESOLVERS.map((resolver) => (
            <li key={resolver.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={state.resolvers.includes(resolver.id)}
                onChange={() => {
                  const selected = state.resolvers.includes(resolver.id);
                  const next = selected
                    ? state.resolvers.filter((r) => r !== resolver.id)
                    : [...state.resolvers, resolver.id];
                  if (next.length > 0) onChange({ ...state, resolvers: next });
                }}
                data-testid={`sidebar-resolver-${resolver.id}`}
                aria-label={`Use ${resolver.label}`}
              />
              <span>{resolver.label}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-2 font-medium text-gray-900 dark:text-gray-100">Session history</h3>
        <p className="text-xs text-gray-600 dark:text-gray-300" data-testid="sidebar-history-count">
          {state.history.length} entr{state.history.length === 1 ? 'y' : 'ies'} in history
          {state.history.length > 0 ? ' (newest first)' : ''}
        </p>
      </div>

      <div>
        <h3 className="mb-2 font-medium text-gray-900 dark:text-gray-100">Share</h3>
        <p className="text-xs text-gray-600 dark:text-gray-300">
          Use the toolbar share button to create a URL containing the current domain, record type
          and latest results; open it to restore this state.
        </p>
      </div>
    </div>
  );
};
