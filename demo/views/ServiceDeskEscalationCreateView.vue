<template>
  <div class="page-stack">
    <el-row :gutter="20">
      <el-col :span="16">
        <el-card header="工单工作台">
          <div class="toolbar">
            <div class="toolbar-left">
              <el-input v-model="keyword" placeholder="输入工单标题后按 Enter 搜索" clearable style="width: 300px" @keyup.enter="runSearch" />
              <el-select v-model="priorityFilter" placeholder="优先级" style="width: 140px">
                <el-option label="全部" value="all" />
                <el-option label="P1" value="P1" />
                <el-option label="P2" value="P2" />
                <el-option label="P3" value="P3" />
              </el-select>
            </div>
            <div class="toolbar-right">
              <el-button @click="runSearch">查询</el-button>
              <el-button type="primary" @click="openDrawer()">新建升级申请</el-button>
            </div>
          </div>

          <el-table :data="filteredTickets" border stripe style="width: 100%">
            <el-table-column prop="ticketNo" label="工单号" width="140" />
            <el-table-column prop="title" label="标题" min-width="240" />
            <el-table-column prop="priority" label="优先级" width="90" />
            <el-table-column prop="owner" label="当前处理人" width="120" />
            <el-table-column label="操作" width="150">
              <template #default="{ row }">
                <el-button link type="primary" @click="openDrawer(row)">发起升级</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <el-col :span="8">
        <el-card header="测试难点">
          <el-descriptions :column="1" border>
            <el-descriptions-item label="先筛选后操作">可以先搜索工单，再对某一行点“发起升级”。</el-descriptions-item>
            <el-descriptions-item label="抽屉内再开弹窗">抽屉里选择升级群组时，会再次打开内层弹窗。</el-descriptions-item>
            <el-descriptions-item label="多步确认">选择群组后仍需回到抽屉点击提交。</el-descriptions-item>
          </el-descriptions>
        </el-card>

        <el-card header="最近升级记录" style="margin-top: 20px">
          <div class="log-list">
            <div v-if="logs.length === 0" class="empty-log">暂无升级记录</div>
            <div v-for="(item, idx) in logs" :key="idx" class="log-item">{{ item }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-drawer v-model="drawerVisible" title="发起升级申请" size="700px">
      <el-form :model="form" label-width="120px">
        <el-form-item label="关联工单">
          <el-input v-model="form.ticketNo" readonly placeholder="可从列表带入工单号" />
        </el-form-item>
        <el-form-item label="升级标题">
          <el-input v-model="form.title" placeholder="例如：核心支付链路超时升级处理" />
        </el-form-item>
        <el-form-item label="升级等级">
          <el-radio-group v-model="form.level">
            <el-radio value="L1">L1</el-radio>
            <el-radio value="L2">L2</el-radio>
            <el-radio value="L3">L3</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="升级群组">
          <div class="group-selector">
            <el-input v-model="form.groupLabel" readonly placeholder="请选择升级群组" />
            <el-button @click="groupDialogVisible = true">选择群组</el-button>
          </div>
        </el-form-item>
        <el-form-item label="通知方式">
          <el-checkbox-group v-model="form.notifyChannels">
            <el-checkbox value="sms">短信</el-checkbox>
            <el-checkbox value="phone">电话</el-checkbox>
            <el-checkbox value="wechat">企业微信</el-checkbox>
            <el-checkbox value="email">邮件</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="升级原因">
          <el-input v-model="form.reason" type="textarea" :rows="4" placeholder="请填写升级原因和影响范围" />
        </el-form-item>
      </el-form>

      <template #footer>
        <div class="drawer-footer">
          <el-button @click="drawerVisible = false">取消</el-button>
          <el-button type="primary" @click="submitEscalation">提交升级申请</el-button>
        </div>
      </template>
    </el-drawer>

    <el-dialog v-model="groupDialogVisible" title="选择升级群组" width="560px">
      <el-table :data="groups" border stripe style="width: 100%">
        <el-table-column prop="name" label="群组名称" min-width="180" />
        <el-table-column prop="scope" label="职责范围" min-width="180" />
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button link type="primary" @click="pickGroup(row)">选择</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

const keyword = ref('')
const priorityFilter = ref('all')
const drawerVisible = ref(false)
const groupDialogVisible = ref(false)
const logs = ref<string[]>([])

const tickets = ref([
  { ticketNo: 'INC-240301', title: '支付回调延迟导致订单状态不同步', priority: 'P1', owner: '林泽' },
  { ticketNo: 'INC-240302', title: '促销中心库存扣减失败', priority: 'P2', owner: '陈宇' },
  { ticketNo: 'INC-240303', title: '门店收银台偶发白屏', priority: 'P3', owner: '张楠' },
])

const filteredTickets = computed(() => tickets.value.filter(item => {
  const hitKeyword = !keyword.value || item.title.includes(keyword.value) || item.ticketNo.includes(keyword.value)
  const hitPriority = priorityFilter.value === 'all' || item.priority === priorityFilter.value
  return hitKeyword && hitPriority
}))

const groups = ref([
  { name: '支付故障升级群', scope: '支付链路、结算、回调' },
  { name: '门店系统响应群', scope: 'POS、门店网络、收银硬件' },
  { name: '营销流量保障群', scope: '大促、库存、优惠券' },
])

const form = reactive({
  ticketNo: '',
  title: '',
  level: 'L2',
  groupLabel: '',
  notifyChannels: [] as string[],
  reason: '',
})

function runSearch() {
  ElMessage.success('工单列表已筛选')
}

function openDrawer(row?: { ticketNo: string; title: string }) {
  drawerVisible.value = true
  if (row) {
    form.ticketNo = row.ticketNo
    form.title = `关于 ${row.title} 的升级处理`
  }
}

function pickGroup(row: { name: string }) {
  form.groupLabel = row.name
  groupDialogVisible.value = false
  ElMessage.success(`已选择群组：${row.name}`)
}

function submitEscalation() {
  const label = form.title || '未命名升级申请'
  logs.value.unshift(`已提交：${label}`)
  drawerVisible.value = false
  ElMessage.success(`升级申请「${label}」已提交`)
}
</script>

<style scoped>
.page-stack { display: flex; flex-direction: column; }
.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; }
.toolbar-left, .toolbar-right { display: flex; gap: 12px; align-items: center; }
.group-selector { display: flex; gap: 12px; width: 100%; }
.group-selector :deep(.el-input) { flex: 1; }
.drawer-footer { display: flex; justify-content: flex-end; gap: 12px; }
.log-list { display: flex; flex-direction: column; gap: 8px; min-height: 120px; }
.log-item { padding: 8px 10px; border-radius: 8px; background: #f4f7fb; font-size: 12px; color: #303133; }
.empty-log { font-size: 12px; color: #909399; }
</style>
