import type { IApiProvider } from '../../services/ApiProvider';
import { listExportableSolutions } from '../../features/flow-editor/managedSolutionExport';

const baseUrl = 'https://pilot.crm.dynamics.com/api/data/v9.2/';
const workflowId = 'a1b2c3d4-0000-1111-2222-333344445555';
const environmentId = 'a1b2c3d4-0000-1111-2222-333344445556';

test('rejects a mismatched Dataverse environment before listing solutions', async () => {
  const request = jest.fn().mockResolvedValue({ Detail: { EnvironmentId: 'another-environment' } });
  await expect(listExportableSolutions(request as IApiProvider['request'] & typeof request,
    baseUrl, environmentId, workflowId, new AbortController().signal)).rejects.toThrow('different environment');
  expect(request).toHaveBeenCalledTimes(1);
});

test('rejects a pagination link that leaves the verified organization', async () => {
  const request = jest.fn()
    .mockResolvedValueOnce({ Detail: { EnvironmentId: environmentId } })
    .mockResolvedValueOnce({ value: [], '@odata.nextLink': 'https://another.crm.dynamics.com/api/data/v9.2/solutioncomponents' });
  await expect(listExportableSolutions(request as IApiProvider['request'] & typeof request,
    baseUrl, environmentId, workflowId, new AbortController().signal)).rejects.toThrow('outside the requested resource');
  expect(request).toHaveBeenCalledTimes(2);
});
