// Component test for the committee-assignment form's client-side validation
// (SEIP-UI-002) — mirrors LoginPage.test.tsx's api mocking pattern. Focuses on
// validate(): the piece most likely to drift from the server's own SCORE-001/
// VAL-002 rules if edited without a matching check here.
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RoundAssignmentsPage } from './RoundAssignmentsPage';
import { api } from '../../api/client';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    api: { ...actual.api, GET: vi.fn(), POST: vi.fn() },
  };
});

const ROUND_ID = '11111111-1111-1111-1111-111111111111';
const VALID_UUID_A = '22222222-2222-2222-2222-222222222222';
const VALID_UUID_B = '33333333-3333-3333-3333-333333333333';
const VALID_UUID_C = '44444444-4444-4444-4444-444444444444';
const VALID_UUID_D = '55555555-5555-5555-5555-555555555555';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/director/rounds/${ROUND_ID}/assignments`]}>
      <Routes>
        <Route path="/director/rounds/:roundId/assignments" element={<RoundAssignmentsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openCreateForm() {
  await userEvent.click(screen.getByRole('button', { name: '+ มอบหมายผู้รับการประเมิน' }));
}

async function fillCommittee(ids: [string, string, string]) {
  const evaluatee = screen.getByLabelText('รหัสผู้รับการประเมิน (personnel id)');
  await userEvent.type(evaluatee, VALID_UUID_D);
  // Anchored on the em dash so this matches only the uuid <input>'s label
  // ("ที่นั่ง N — ...") and not the role <select>'s aria-label ("บทบาทที่นั่ง N"),
  // which also contains "ที่นั่ง N" as a substring.
  await userEvent.type(screen.getByLabelText(/^ที่นั่ง 1 —/), ids[0]);
  await userEvent.type(screen.getByLabelText(/^ที่นั่ง 2 —/), ids[1]);
  await userEvent.type(screen.getByLabelText(/^ที่นั่ง 3 —/), ids[2]);
}

describe('RoundAssignmentsPage — committee assignment form', () => {
  beforeEach(() => {
    vi.mocked(api.GET).mockReset();
    vi.mocked(api.POST).mockReset();
    vi.mocked(api.GET).mockResolvedValue({
      data: { items: [], meta: { page: 1, page_size: 50, total: 0 } }, error: undefined, response: new Response(),
    } as never);
  });

  test('rejects duplicate committee evaluator ids without calling the API (mirrors server VAL-002)', async () => {
    renderPage();
    await waitFor(() => expect(api.GET).toHaveBeenCalledTimes(1));
    await openCreateForm();
    await fillCommittee([VALID_UUID_A, VALID_UUID_A, VALID_UUID_B]);
    await userEvent.click(screen.getByRole('button', { name: 'มอบหมาย' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('กรรมการทั้ง 3 คนต้องไม่ซ้ำกัน');
    expect(api.POST).not.toHaveBeenCalled();
  });

  test('rejects a malformed evaluator id without calling the API', async () => {
    renderPage();
    await waitFor(() => expect(api.GET).toHaveBeenCalledTimes(1));
    await openCreateForm();
    await fillCommittee(['not-a-uuid', VALID_UUID_B, VALID_UUID_C]);
    await userEvent.click(screen.getByRole('button', { name: 'มอบหมาย' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('UUID');
    expect(api.POST).not.toHaveBeenCalled();
  });

  test('requires exactly one chair (mirrors server SCORE-001/VAL-002 "one chair" rule)', async () => {
    renderPage();
    await waitFor(() => expect(api.GET).toHaveBeenCalledTimes(1));
    await openCreateForm();
    await fillCommittee([VALID_UUID_A, VALID_UUID_B, VALID_UUID_C]);
    // demote seat 1 (default chair) to member -> zero chairs among the 3
    await userEvent.selectOptions(screen.getByLabelText('บทบาทที่นั่ง 1'), 'member');
    await userEvent.click(screen.getByRole('button', { name: 'มอบหมาย' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('ต้องมีประธานกรรมการ 1 คนเท่านั้น');
    expect(api.POST).not.toHaveBeenCalled();
  });

  test('valid committee submits to the API with seat numbers 1..3 and calls onCreated (reload)', async () => {
    vi.mocked(api.POST).mockResolvedValueOnce({
      data: { id: 'a1', round_id: ROUND_ID, evaluatee_personnel_id: VALID_UUID_D, status: 'pending', committee: [] },
      error: undefined, response: new Response(),
    } as never);

    renderPage();
    await waitFor(() => expect(api.GET).toHaveBeenCalledTimes(1));
    await openCreateForm();
    await fillCommittee([VALID_UUID_A, VALID_UUID_B, VALID_UUID_C]);
    await userEvent.click(screen.getByRole('button', { name: 'มอบหมาย' }));

    await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
    const options = (vi.mocked(api.POST).mock.calls[0] as unknown as [string, { body: unknown }])[1];
    expect(options.body).toEqual({
      evaluatee_personnel_id: VALID_UUID_D,
      committee: [
        { evaluator_user_id: VALID_UUID_A, committee_role: 'chair', seat_number: 1 },
        { evaluator_user_id: VALID_UUID_B, committee_role: 'member', seat_number: 2 },
        { evaluator_user_id: VALID_UUID_C, committee_role: 'member', seat_number: 3 },
      ],
    });
    // onCreated() reloads the assignment list — a second GET call
    await waitFor(() => expect(api.GET).toHaveBeenCalledTimes(2));
  });
});
