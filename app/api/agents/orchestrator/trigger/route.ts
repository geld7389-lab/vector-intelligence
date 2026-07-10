import { NextRequest } from 'next/server';
import { POST as runOrchestrator } from '../route';

// TEMP diagnostic route — calls the real orchestrator POST handler via GET so
// it can be triggered from tools that can't send a POST body. Remove after
// verifying the run-lock and full agent cycle work correctly.
export async function GET(req: NextRequest) {
  const fakeReq = new NextRequest(req.url, { method: 'POST', body: JSON.stringify({}), headers: { 'Content-Type': 'application/json' } });
  return runOrchestrator(fakeReq);
}
