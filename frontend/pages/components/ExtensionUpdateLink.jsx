import { Link } from 'react-router-dom';
import { useExtensionStatus } from '../../extensionBridge.js';

// Dashboard-only nudge: when an installed extension is out of date, link to the
// Console download section. Renders nothing otherwise (install/up-to-date states
// live on the Console page now).
export default function ExtensionUpdateLink() {
  const { outOfDate, latestVersion } = useExtensionStatus();
  if (!outOfDate) return null;

  return (
    <Link to="/console" className="ext-install-btn">
      Update Extension{latestVersion ? ` → v${latestVersion}` : ''}
    </Link>
  );
}
