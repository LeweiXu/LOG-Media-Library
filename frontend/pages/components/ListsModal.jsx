import ListsPanel from './ListsPanel.jsx';

/**
 * Modal wrapper around ListsPanel — used by the Library "+ New" chip for a quick
 * add-to-list flow. The Console page renders <ListsPanel> inline instead.
 */
export default function ListsModal(props) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && props.onClose?.()}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">Custom Lists</span>
          <button className="icon-btn" onClick={props.onClose}>✕</button>
        </div>
        <ListsPanel {...props} />
      </div>
    </div>
  );
}
