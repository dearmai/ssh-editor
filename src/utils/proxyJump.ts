import type { JumpHost, SshConfigHost } from '../types';

/**
 * ssh_config의 ProxyJump 값(`[user@]host[:port],...`)을 점프 호스트 목록으로 변환한다.
 * host가 .ssh/config의 다른 Host 별칭이면 그 호스트의 HostName·Port·User·IdentityFile을 사용한다.
 */
export function parseProxyJump(value: string | undefined, hosts: SshConfigHost[]): JumpHost[] {
  if (!value || value.trim().toLowerCase() === 'none') return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((spec) => {
      const at = spec.lastIndexOf('@');
      const user = at >= 0 ? spec.slice(0, at) : '';
      let hostPart = at >= 0 ? spec.slice(at + 1) : spec;
      let port: number | undefined;
      // [IPv6]:port 또는 host:port
      const m = hostPart.match(/^\[(.+)\](?::(\d+))?$/) ?? hostPart.match(/^([^:]+)(?::(\d+))?$/);
      if (m) {
        hostPart = m[1];
        if (m[2]) port = parseInt(m[2]);
      }
      const alias = hosts.find((h) => h.alias === hostPart);
      return {
        hostname: alias?.hostname || hostPart,
        port: port ?? alias?.port ?? 22,
        username: user || alias?.user || '',
        authType: alias?.identityFile ? 'publicKey' : 'agent',
        identityFile: alias?.identityFile,
      };
    });
}
