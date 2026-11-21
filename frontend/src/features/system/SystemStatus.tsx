import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  Database,
  RefreshCw,
  Server,
  Waypoints,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getReadiness } from './api';

export function SystemStatus() {
  const query = useQuery({
    queryKey: ['system', 'readiness'],
    queryFn: ({ signal }) => getReadiness(signal),
    retry: 1,
    refetchInterval: 30_000,
  });
  const services = [
    {
      name: 'API service',
      detail: 'FastAPI application',
      icon: Server,
      ready: !query.isError && !!query.data,
    },
    {
      name: 'Database',
      detail: 'PostgreSQL connection',
      icon: Database,
      ready: !query.isError && query.data?.database,
    },
    {
      name: 'Background infrastructure',
      detail: 'Redis connection',
      icon: Waypoints,
      ready: !query.isError && query.data?.redis,
    },
  ];
  return (
    <section className="panel system-panel" aria-labelledby="system-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">CONNECTED FOUNDATION</p>
          <h2 id="system-title">System status</h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw size={14} className={query.isFetching ? 'spin' : ''} />
          Refresh
        </Button>
      </div>
      {query.isPending ? (
        <div className="skeleton" role="status">
          Checking services…
        </div>
      ) : (
        <>
          {query.isError && (
            <p role="alert" className="notice">
              The API is unreachable. Start the backend, then refresh.
            </p>
          )}
          <ul className="service-list">
            {services.map(({ name, detail, icon: Icon, ready }) => (
              <li key={name}>
                <span className="service-icon">
                  <Icon size={20} />
                </span>
                <div>
                  <strong>{name}</strong>
                  <small>{detail}</small>
                </div>
                <span className={ready ? 'badge success' : 'badge neutral'}>
                  {ready ? (
                    <>
                      <CheckCircle2 size={13} />
                      Connected
                    </>
                  ) : query.isError ? (
                    'Unknown'
                  ) : (
                    'Unavailable'
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="status-footnote">
            Live connection checks · updates every 30 seconds
          </p>
        </>
      )}
    </section>
  );
}
