import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AiProvidersSettings } from './AiProvidersSettings.tsx';
import { createApiClient } from '@vjt/api-client';

interface FakeProvider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
const noContent = () => new Response(null, { status: 204 });

function provider(id: string, name: string, hasApiKey: boolean): FakeProvider {
  return {
    id,
    name,
    baseUrl: 'http://localhost:11434',
    model: 'llama3',
    hasApiKey,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };
}

describe('mobile AiProvidersSettings', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let providers: FakeProvider[];
  let tasks: { task: string; providerId: string | null }[];
  // openapi-fetch hands fetch a single Request; the stub records writes.
  let writes: { method: string; url: string; body?: unknown }[];

  beforeEach(() => {
    providers = [provider('p-1', 'Local LLM', true)];
    tasks = [{ task: 'story', providerId: 'p-1' }];
    writes = [];
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const request = new Request(input);
      const method = request.method.toUpperCase();
      const path = new URL(request.url).pathname;
      let body: unknown;
      if (request.body) {
        try {
          body = await request.clone().json();
        } catch {
          body = undefined;
        }
      }
      writes.push({ method, url: request.url as string, body });

      if (method === 'GET' && path === '/ai-providers') return jsonResponse(providers);
      if (method === 'GET' && path === '/ai-tasks') return jsonResponse(tasks);
      if (method === 'POST' && path === '/ai-providers') {
        const input = body as { name: string; baseUrl: string; model: string };
        const created: FakeProvider = {
          id: `p-${providers.length + 1}`,
          name: input.name,
          baseUrl: input.baseUrl,
          model: input.model,
          hasApiKey: 'apiKey' in (body as object),
          createdAt: '2026-10-01T00:00:00Z',
          updatedAt: '2026-10-01T00:00:00Z',
        };
        providers = [...providers, created];
        return jsonResponse(created, 201);
      }
      const providerMatch = path.match(/^\/ai-providers\/(p-\d+)$/);
      if (providerMatch && method === 'PATCH') {
        const patch = body as { name?: string; model?: string; apiKey?: string | null };
        providers = providers.map((p) =>
          p.id === providerMatch[1]
            ? {
                ...p,
                name: patch.name ?? p.name,
                model: patch.model ?? p.model,
                hasApiKey: patch.apiKey === null ? false : patch.apiKey ? true : p.hasApiKey,
              }
            : p,
        );
        return jsonResponse(providers.find((p) => p.id === providerMatch[1]));
      }
      if (providerMatch && method === 'DELETE') {
        providers = providers.filter((p) => p.id !== providerMatch[1]);
        return noContent();
      }
      if (/^\/ai-providers\/p-\d+\/test$/.test(path) && method === 'POST') {
        return jsonResponse({ ok: true, latencyMs: 120, message: 'Connected' });
      }
      const taskMatch = path.match(/^\/ai-tasks\/(story|grammar_content)$/);
      if (taskMatch && method === 'PUT') {
        const providerId = (body as { providerId: string }).providerId;
        tasks = tasks.map((t) => (t.task === taskMatch[1] ? { ...t, providerId } : t));
        return noContent();
      }
      if (taskMatch && method === 'DELETE') {
        tasks = tasks.map((t) => (t.task === taskMatch[1] ? { ...t, providerId: null } : t));
        return noContent();
      }
      return jsonResponse({ message: `stub: unexpected ${method} ${path}` }, 500);
    });
  });

  function renderApp() {
    const client = createApiClient({
      baseUrl: 'http://localhost',
      fetch: fetchMock as unknown as typeof fetch,
    });
    return render(<AiProvidersSettings client={client} onBack={() => {}} />);
  }

  async function waitForLoaded() {
    await waitFor(() => {
      expect(screen.getByText('Story generation')).toBeTruthy();
    });
  }

  it('lists providers with their key state and task assignment', async () => {
    renderApp();
    await waitForLoaded();
    expect(
      screen.getByText('llama3 at http://localhost:11434 · Key saved · used for Story generation'),
    ).toBeTruthy();
  });

  it('adds a provider and clears the form', async () => {
    renderApp();
    await waitForLoaded();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Hosted GPT' } });
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'https://api.openai.com/v1' },
    });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gpt-4o-mini' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }));

    await waitFor(() => {
      const post = writes.find((w) => w.method === 'POST' && w.url.endsWith('/ai-providers'));
      expect(post?.body).toEqual({
        name: 'Hosted GPT',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
      });
    });
    await waitFor(() => {
      expect(screen.getByText('gpt-4o-mini at https://api.openai.com/v1 · No key')).toBeTruthy();
    });
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');
  });

  it('edits without a key field, keeping the stored key', async () => {
    renderApp();
    await waitForLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Local LLM');
    expect(screen.getByPlaceholderText('Key saved — leave empty to keep it')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'llama3.1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      const patch = writes.find((w) => w.method === 'PATCH');
      expect(patch?.url).toContain('/ai-providers/p-1');
      // No apiKey key at all: the stored key stays put.
      expect(patch?.body).toEqual({ name: 'Local LLM', baseUrl: 'http://localhost:11434', model: 'llama3.1' });
    });
    await waitFor(() => {
      expect(
        screen.getByText('llama3.1 at http://localhost:11434 · Key saved · used for Story generation'),
      ).toBeTruthy();
    });
  });

  it('drops the stored key only when the toggle says so', async () => {
    renderApp();
    await waitForLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Remove the saved key' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      const patch = writes.find((w) => w.method === 'PATCH');
      expect((patch?.body as { apiKey: unknown }).apiKey).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByText(/No key/)).toBeTruthy();
    });
  });

  it('tests the connection and reports the outcome', async () => {
    renderApp();
    await waitForLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    await waitFor(() => {
      expect(screen.getByText('Connected (120 ms)')).toBeTruthy();
    });
    const testPost = writes.find((w) => w.url.endsWith('/ai-providers/p-1/test'));
    expect(testPost?.method).toBe('POST');
  });

  it('deletes a provider only after confirming', async () => {
    renderApp();
    await waitForLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(writes.some((w) => w.method === 'DELETE' && w.url.includes('/ai-providers/'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

    await waitFor(() => {
      expect(writes.some((w) => w.method === 'DELETE' && w.url.endsWith('/ai-providers/p-1'))).toBe(
        true,
      );
    });
    await waitFor(() => {
      expect(screen.getByText('No providers yet. Add an OpenAI-compatible endpoint below.')).toBeTruthy();
    });
  });

  it('assigning None unassigns the task', async () => {
    renderApp();
    await waitForLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'None' }));

    await waitFor(() => {
      expect(
        writes.some((w) => w.method === 'DELETE' && w.url.endsWith('/ai-tasks/story')),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByText(/used for Story generation/)).toBeNull();
    });
  });
});
