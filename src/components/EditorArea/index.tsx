import { Allotment } from 'allotment';
import { useEditorStore } from '../../stores/editorStore';
import EditorTabs from './EditorTabs';
import MonacoPane from './MonacoPane';
import WelcomeScreen from './WelcomeScreen';
import styles from './EditorArea.module.css';

export default function EditorArea() {
  const { tabs, activeTabId, splitView, rightPaneTabId } = useEditorStore();

  return (
    <div className={styles.area}>
      {splitView ? (
        <Allotment>
          <Allotment.Pane>
            <div className={styles.pane}>
              <EditorTabs pane="left" />
              {activeTabId ? <MonacoPane tabId={activeTabId} /> : <WelcomeScreen />}
            </div>
          </Allotment.Pane>
          <Allotment.Pane>
            <div className={styles.pane}>
              <EditorTabs pane="right" />
              {rightPaneTabId ? <MonacoPane tabId={rightPaneTabId} /> : <WelcomeScreen />}
            </div>
          </Allotment.Pane>
        </Allotment>
      ) : (
        <div className={styles.pane}>
          <EditorTabs pane="left" />
          {tabs.length === 0 ? (
            <WelcomeScreen />
          ) : activeTabId ? (
            <MonacoPane tabId={activeTabId} />
          ) : (
            <WelcomeScreen />
          )}
        </div>
      )}
    </div>
  );
}
