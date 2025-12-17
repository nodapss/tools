import re

# Read the backup file
with open(r'c:\Users\admin\Documents\Projects_SEMES\RFMatcher\SAMBB_v1.01.007\Vitis\RFControl\index_backup.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace CSS link
content = content.replace('href="style.css"', 'href="css/main.css"')

# Replace script tags at the end
content = re.sub(
    r'<script src="smithchart\.js"></script>\s*<script src="app\.js"></script>',
    '''<script src="smithchart.js"></script>
    <script src="js/namespace.js"></script>
    <script src="js/ui/ui.js"></script>
    <script src="js/ui/terminal.js"></script>
    <script src="js/ui/charts.js"></script>
    <script src="js/modules/protocol.js"></script>
    <script src="js/modules/mockData.js"></script>
    <script src="js/core/serial.js"></script>
    <script src="js/main.js"></script>''',
    content
)

# Replace the RF/FFT panels with a single togglable panel
old_panels = '''                <section class="panel graph-panel">
                    <h2>RF Sensors (Raw)</h2>
                    <div class="graph-container">
                        <canvas id="rfGraph" height="150"></canvas>
                    </div>
                </section>

                <section class="panel fft-panel">
                    <h2>FFT Analysis</h2>
                    <div class="graph-container">
                        <canvas id="fftGraph" height="150"></canvas>
                    </div>
                </section>'''

new_panel = '''                <section class="panel data-panel">
                    <div class="panel-header-with-toggle">
                        <h2 id="dataPanelTitle">Time Domain</h2>
                        <button id="btnToggleData" class="btn sm secondary">↔ FFT</button>
                    </div>
                    <div class="graph-container">
                        <canvas id="rfGraph" height="150" style="display: block;"></canvas>
                        <canvas id="fftGraph" height="150" style="display: none;"></canvas>
                    </div>
                </section>'''

content = content.replace(old_panels, new_panel)

# Write the modified content
with open(r'c:\Users\admin\Documents\Projects_SEMES\RFMatcher\SAMBB_v1.01.007\Vitis\RFControl\index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('HTML file updated successfully')
