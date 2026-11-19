import { PrintJobs } from './PrintJobs.js';
import { QueueJobs } from './QueueJobs.js';

export class TestPrintJobs extends QueueJobs {
  render() {
    const mode = this.state.data?.preparationMode;
    const settings = this.state.data && mode !== 'routine' && React.createElement(PrintJobs, {
      admin: true, settingsOnly: mode === 'training', printing: this.props.printing, language: this.props.language,
    });
    return this.renderPanel(settings);
  }
}
