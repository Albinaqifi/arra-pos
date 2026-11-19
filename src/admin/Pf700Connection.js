import { financeText } from './finance-i18n.js';

const h = React.createElement;

export class Pf700Connection extends React.Component {
  constructor(props) {
    super(props);
    this.state = { profile: null, status: 'idle' };
    this.generation = 0;
    this.inFlight = false;
  }

  componentDidMount() {
    this.active = true;
  }

  componentWillUnmount() {
    this.active = false;
    this.generation++;
    this.inFlight = false;
  }

  async request(loadingProfile) {
    if (!this.active || this.inFlight) return;
    if (!loadingProfile && !this.state.profile) return;
    const generation = this.generation;
    this.inFlight = true;
    this.setState({ status: loadingProfile ? 'loading' : 'running' });
    try {
      const reply = loadingProfile ? await this.props.loadProfile() : await this.props.simulateStatus();
      if (generation !== this.generation) return;
      if (reply?.denied) {
        this.setState({ status: 'denied', profile: null });
      } else if (loadingProfile && reply?.ok && reply.data?.profile && reply.data.hardwareVerified === false) {
        this.setState({ status: 'ready', profile: reply.data.profile });
      } else if (!loadingProfile && reply?.ok && reply.data?.mode === 'offline' &&
                 reply.data.result === 'simulated-response' && reply.data.hardwareVerified === false) {
        this.setState({ status: 'passed' });
      } else {
        this.setState({ status: 'failed' });
      }
    } catch (_) {
      if (generation === this.generation) this.setState({ status: 'failed' });
    } finally {
      if (generation === this.generation) this.inFlight = false;
    }
  }

  render() {
    const { profile, status } = this.state;
    const t = (key, values) => financeText(this.props.language, key, values);
    return h('details', {
      className: 'day-details',
      onToggle: event => {
        if (event.currentTarget.open && status === 'idle') this.request(true);
      }
    },
    h('summary', null, t('PF700 fiscal printer connection')),
    status === 'loading' && h('p', { role: 'status' }, t('Loading connection settings…')),
    status === 'denied' && h('p', { role: 'alert' }, t('Access to the fiscal printer settings was denied.')),
    profile && h(React.Fragment, null,
      h('p', null, t('{port} · {baudRate} baud · {dataBits} data bits · {parity} · {stopBits} stop bit', {
        ...profile, parity: profile.parity === 'none' ? t('no parity') : profile.parity
      })),
      h('p', null, t('Physical connection unverified. This check uses a simulated printer.')),
      h('button', {
        type: 'button', disabled: status === 'running',
        onClick: () => this.request(false)
      }, t('Run offline simulation'))),
    status === 'running' && h('p', { role: 'status' }, t('Running simulation…')),
    status === 'passed' && h('p', { role: 'status' }, t('Simulation passed. Arra read the simulated status response.')),
    status === 'failed' && h('p', { role: 'alert' }, profile
      ? t('Simulation failed. Try running it again.')
      : t('Could not load the fiscal printer settings.')),
    status === 'failed' && !profile && h('button', {
      type: 'button', onClick: () => this.request(true)
    }, t('Try again')));
  }
}
