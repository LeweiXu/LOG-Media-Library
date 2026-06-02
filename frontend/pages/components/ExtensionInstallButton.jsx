import { useState } from 'react';
import { useExtensionStatus } from '../../extensionBridge.js';
import ExtensionInstallModal from './ExtensionInstallModal.jsx';

// Tasteful right-sidebar entry point to the extension modal. Hidden once the
// extension is detected and up to date; shows "Update Extension" when an installed
// copy is older than the latest .xpi/.zip in the repo.
export default function ExtensionInstallButton() {
  const { present, outOfDate } = useExtensionStatus();
  const [open, setOpen] = useState(false);
  if (present && !outOfDate) return null;

  return (
    <>
      <button type="button" className="ext-install-btn" onClick={() => setOpen(true)}>
        {present ? 'Update Extension' : 'Install Extension'}
      </button>
      {open && <ExtensionInstallModal onClose={() => setOpen(false)} />}
    </>
  );
}
