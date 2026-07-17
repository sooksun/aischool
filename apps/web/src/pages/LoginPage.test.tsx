import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import { AuthProvider } from '../hooks/useAuth';
import { api } from '../api/client';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    api: { ...actual.api, POST: vi.fn(), GET: vi.fn() },
  };
});

function renderLoginPage() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.mocked(api.POST).mockReset();
    sessionStorage.clear();
  });

  test('renders accessible Thai-labeled email and password fields', () => {
    renderLoginPage();
    expect(screen.getByLabelText('อีเมล')).toBeInTheDocument();
    expect(screen.getByLabelText('รหัสผ่าน')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'เข้าสู่ระบบ' })).toBeInTheDocument();
  });

  test('shows a Thai error message on AUTH-001 without exposing the raw server message', async () => {
    vi.mocked(api.POST).mockResolvedValueOnce({
      data: undefined,
      error: { code: 'AUTH-001', message: 'Invalid email or password' },
      response: new Response(),
    } as never);

    renderLoginPage();
    await userEvent.type(screen.getByLabelText('อีเมล'), 'x@x.io');
    await userEvent.type(screen.getByLabelText('รหัสผ่าน'), 'wrongpassword');
    await userEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));

    const alert = await screen.findByRole('alert');
    // thaiMessageFor(AUTH-001) — never the raw English server message
    expect(alert).toHaveTextContent('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    expect(alert).not.toHaveTextContent('Invalid email or password');
  });

  test('submit button disables while a login request is in flight', async () => {
    let resolveLogin: (v: unknown) => void = () => {};
    vi.mocked(api.POST).mockReturnValueOnce(new Promise((resolve) => { resolveLogin = resolve; }) as never);

    renderLoginPage();
    await userEvent.type(screen.getByLabelText('อีเมล'), 'x@x.io');
    await userEvent.type(screen.getByLabelText('รหัสผ่าน'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));

    expect(screen.getByRole('button', { name: /กำลังเข้าสู่ระบบ/ })).toBeDisabled();
    resolveLogin({ data: { access_token: 'a', refresh_token: 'b', expires_in: 900 }, error: undefined, response: new Response() });
    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
  });
});
