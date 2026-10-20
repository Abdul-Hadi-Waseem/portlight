/** What a container image is, from its repository name (`postgres`, `bitnami/redis` → `redis`). */
export interface ImageRule {
  label: string;
  /** Last path segment: `postgres`, `bitnami/postgres` and `docker.io/library/postgres` all match `postgres`. */
  repos?: readonly string[];
  /** Full `owner/name`, for names too generic on their own (`kindest/node` is not Node.js). */
  paths?: readonly string[];
  /** Database or broker: listed as a service-like container and never sent HTTP requests. */
  service?: boolean;
}

export const IMAGE_RULES: readonly ImageRule[] = [
  { label: 'PostgreSQL', repos: ['postgres', 'postgresql', 'postgis', 'timescaledb', 'pgvector'], service: true },
  { label: 'MySQL', repos: ['mysql', 'mysql-server', 'mariadb', 'percona'], service: true },
  { label: 'SQL Server', paths: ['mssql/server', 'azure-sql-edge'], repos: ['azure-sql-edge'], service: true },
  { label: 'MongoDB', repos: ['mongo', 'mongodb', 'mongodb-community-server'], service: true },
  { label: 'Redis', repos: ['redis', 'redis-stack', 'valkey', 'keydb', 'dragonfly'], service: true },
  { label: 'RabbitMQ', repos: ['rabbitmq'], service: true },
  { label: 'Kafka', repos: ['kafka', 'cp-kafka', 'redpanda'], service: true },
  { label: 'Memcached', repos: ['memcached'], service: true },
  { label: 'Cassandra', repos: ['cassandra', 'scylla'], service: true },
  { label: 'ZooKeeper', repos: ['zookeeper', 'cp-zookeeper'], service: true },
  { label: 'Kubernetes (kind)', paths: ['kindest/node'], service: true },
  { label: 'Kubernetes (minikube)', paths: ['k8s-minikube/kicbase'], service: true },
  { label: 'Kubernetes (k3s)', paths: ['rancher/k3s'], service: true },
  { label: 'Elasticsearch', repos: ['elasticsearch', 'opensearch'] },
  { label: 'Kibana', repos: ['kibana', 'opensearch-dashboards'] },
  { label: 'Jenkins', repos: ['jenkins'] },
  { label: 'Grafana', repos: ['grafana'] },
  { label: 'Prometheus', repos: ['prometheus'] },
  { label: 'Vault', repos: ['vault'] },
  { label: 'Keycloak', repos: ['keycloak'] },
  { label: 'SonarQube', repos: ['sonarqube'] },
  { label: 'ClickHouse', repos: ['clickhouse-server'] },
  { label: 'nginx', repos: ['nginx'] },
  { label: 'Apache', repos: ['httpd'] },
  { label: 'Caddy', repos: ['caddy'] },
  { label: 'Traefik', repos: ['traefik'] },
  { label: 'MinIO', repos: ['minio'] },
  { label: 'LocalStack', repos: ['localstack'] },
  { label: 'Mailpit', repos: ['mailpit', 'mailhog'] },
];

/** `docker.io/library/postgres:16-alpine` → `docker.io/library/postgres` (no tag or digest). */
function imagePath(image: string): string {
  const withoutDigest = image.split('@')[0] ?? image;
  const lastSlash = withoutDigest.lastIndexOf('/');
  const colon = withoutDigest.indexOf(':', lastSlash + 1);
  return colon === -1 ? withoutDigest : withoutDigest.slice(0, colon);
}

/** `docker.io/library/postgres:16-alpine` → `postgres`; `ghcr.io/org/app@sha256:…` → `app`. */
export function imageRepo(image: string): string {
  const path = imagePath(image);
  return path.slice(path.lastIndexOf('/') + 1);
}

export function detectImage(image: string): { label: string; service: boolean } {
  const path = imagePath(image);
  const repo = imageRepo(image);
  const rule = IMAGE_RULES.find(
    (candidate) => candidate.repos?.includes(repo) || candidate.paths?.some((p) => path === p || path.endsWith(`/${p}`)),
  );
  return { label: rule?.label ?? repo, service: rule?.service ?? false };
}
