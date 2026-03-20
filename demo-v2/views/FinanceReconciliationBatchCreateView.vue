<template>
  <div class="page-stack">
    <el-row :gutter="20">
      <el-col :span="17">
        <el-card header="待处理账单来源">
          <div class="toolbar">
            <div class="toolbar-left">
              <el-input v-model="keyword" placeholder="输入渠道或账单名称后按 Enter 搜索" clearable style="width: 280px" @keyup.enter="runSearch" />
              <el-select v-model="channel" placeholder="渠道" style="width: 160px">
                <el-option label="全部渠道" value="all" />
                <el-option label="电商平台" value="ecommerce" />
                <el-option label="门店 POS" value="pos" />
                <el-option label="即时零售" value="instant" />
              </el-select>
            </div>
            <div class="toolbar-right">
              <el-button @click="runSearch">查询</el-button>
              <el-button type="primary" @click="drawerVisible = true">新建对账批次</el-button>
            </div>
          </div>

          <el-table :data="filteredRows" border stripe style="width: 100%">
            <el-table-column type="selection" width="55" />
            <el-table-column prop="statementName" label="账单名称" min-width="220" />
            <el-table-column prop="channelLabel" label="来源渠道" width="140" />
            <el-table-column prop="cycle" label="账期" width="180" />
            <el-table-column prop="owner" label="负责人" width="120" />
            <el-table-column prop="amount" label="金额" width="140" />
          </el-table>
        </el-card>
      </el-col>

      <el-col :span="7">
        <el-card header="复杂点提示">
          <el-steps direction="vertical" :active="4">
            <el-step title="先进入深层财务路径" description="路径较深，先定位左侧菜单。" />
            <el-step title="打开抽屉" description="点击“新建对账批次”进入配置抽屉。" />
            <el-step title="切换 Tab" description="在抽屉中依次填写基础信息、匹配规则、通知设置。" />
            <el-step title="确认生成" description="最后还会出现二次确认弹窗。" />
          </el-steps>
        </el-card>

        <el-card header="最近记录" style="margin-top: 20px">
          <div class="log-list">
            <div v-if="logs.length === 0" class="empty-log">暂无生成记录</div>
            <div v-for="(item, idx) in logs" :key="idx" class="log-item">{{ item }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-drawer v-model="drawerVisible" title="新建对账批次" size="760px">
      <el-tabs v-model="activeTab">
        <el-tab-pane label="基础信息" name="basic">
          <el-form :model="form" label-width="120px">
            <el-form-item label="批次名称">
              <el-input v-model="form.batchName" placeholder="例如：2026-03 华东渠道对账批次" />
            </el-form-item>
            <el-form-item label="账期范围">
              <el-date-picker v-model="form.period" type="daterange" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" />
            </el-form-item>
            <el-form-item label="账单来源">
              <el-checkbox-group v-model="form.sources">
                <el-checkbox value="ecommerce">电商平台</el-checkbox>
                <el-checkbox value="pos">门店 POS</el-checkbox>
                <el-checkbox value="instant">即时零售</el-checkbox>
                <el-checkbox value="erp">ERP 导入</el-checkbox>
              </el-checkbox-group>
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="匹配规则" name="rules">
          <el-form :model="form" label-width="120px">
            <el-form-item label="匹配策略">
              <el-radio-group v-model="form.matchMode">
                <el-radio value="strict">严格匹配</el-radio>
                <el-radio value="fuzzy">模糊匹配</el-radio>
                <el-radio value="hybrid">混合匹配</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="差异阈值">
              <el-input-number v-model="form.tolerance" :min="0" :max="10000" />
            </el-form-item>
            <el-form-item label="异常处理">
              <el-select v-model="form.exceptionAction" placeholder="请选择异常处理方式">
                <el-option label="自动挂起" value="hold" />
                <el-option label="自动生成工单" value="ticket" />
                <el-option label="直接通知财务" value="notify" />
              </el-select>
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="通知设置" name="notice">
          <el-form :model="form" label-width="120px">
            <el-form-item label="通知群组">
              <el-select v-model="form.noticeGroups" multiple collapse-tags placeholder="请选择通知群组">
                <el-option label="财务共享中心" value="finance-center" />
                <el-option label="业务对账群" value="biz-recon" />
                <el-option label="区域经营群" value="region-ops" />
              </el-select>
            </el-form-item>
            <el-form-item label="邮件摘要">
              <el-switch v-model="form.emailDigest" active-text="开启" inactive-text="关闭" />
            </el-form-item>
            <el-form-item label="说明">
              <el-input v-model="form.remark" type="textarea" :rows="4" placeholder="请输入备注说明" />
            </el-form-item>
          </el-form>
        </el-tab-pane>
      </el-tabs>

      <template #footer>
        <div class="drawer-footer">
          <el-button @click="drawerVisible = false">取消</el-button>
          <el-button @click="activeTab = 'rules'">下一步到规则</el-button>
          <el-button type="primary" @click="confirmVisible = true">生成批次</el-button>
        </div>
      </template>
    </el-drawer>

    <el-dialog v-model="confirmVisible" title="确认生成对账批次" width="420px">
      <span>确认生成该对账批次吗？生成后会写入最近记录。</span>
      <template #footer>
        <el-button @click="confirmVisible = false">返回修改</el-button>
        <el-button type="primary" @click="submitBatch">确认生成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

const keyword = ref('')
const channel = ref('all')
const drawerVisible = ref(false)
const confirmVisible = ref(false)
const activeTab = ref('basic')
const logs = ref<string[]>([])

const rows = ref([
  { statementName: '2026-03 电商平台汇总账单', channelLabel: '电商平台', channel: 'ecommerce', cycle: '2026-03-01 ~ 2026-03-31', owner: '周宁', amount: '¥ 1,284,300' },
  { statementName: '2026-03 华东门店 POS 汇总', channelLabel: '门店 POS', channel: 'pos', cycle: '2026-03-01 ~ 2026-03-31', owner: '刘晨', amount: '¥ 842,100' },
  { statementName: '2026-03 即时零售配送账单', channelLabel: '即时零售', channel: 'instant', cycle: '2026-03-01 ~ 2026-03-31', owner: '王霖', amount: '¥ 233,000' },
])

const filteredRows = computed(() => rows.value.filter(item => {
  const hitKeyword = !keyword.value || item.statementName.includes(keyword.value) || item.channelLabel.includes(keyword.value)
  const hitChannel = channel.value === 'all' || item.channel === channel.value
  return hitKeyword && hitChannel
}))

const form = reactive({
  batchName: '',
  period: null as [Date, Date] | null,
  sources: [] as string[],
  matchMode: 'strict',
  tolerance: 100,
  exceptionAction: '',
  noticeGroups: [] as string[],
  emailDigest: true,
  remark: '',
})

function runSearch() {
  ElMessage.success('账单来源已筛选')
}

function submitBatch() {
  const name = form.batchName || '未命名对账批次'
  logs.value.unshift(`已生成：${name}`)
  confirmVisible.value = false
  drawerVisible.value = false
  ElMessage.success(`对账批次「${name}」已生成`)
}
</script>

<style scoped>
.page-stack { display: flex; flex-direction: column; }
.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; }
.toolbar-left, .toolbar-right { display: flex; gap: 12px; align-items: center; }
.log-list { display: flex; flex-direction: column; gap: 8px; min-height: 120px; }
.log-item { padding: 8px 10px; border-radius: 8px; background: #f4f7fb; font-size: 12px; color: #303133; }
.empty-log { font-size: 12px; color: #909399; }
.drawer-footer { display: flex; justify-content: flex-end; gap: 12px; }
</style>
