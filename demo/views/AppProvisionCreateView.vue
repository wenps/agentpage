<template>
  <div class="page-stack">
    <el-row :gutter="20">
      <el-col :span="16">
        <el-card header="实例开通向导">
          <el-steps :active="2" finish-status="success" align-center>
            <el-step title="选择租户" description="确定实例归属租户" />
            <el-step title="选择应用" description="配置应用和版本" />
            <el-step title="设置规格" description="填写容量和网络参数" />
            <el-step title="确认开通" description="完成审批并提交" />
          </el-steps>
        </el-card>

        <el-card header="已开通实例" style="margin-top: 20px">
          <div class="toolbar">
            <el-input v-model="search" placeholder="搜索租户 / 实例名称" clearable style="width: 280px" />
            <el-button type="primary" @click="dialogVisible = true">开通新实例</el-button>
          </div>
          <el-table :data="filteredInstances" border style="width: 100%">
            <el-table-column prop="tenant" label="租户" min-width="180" />
            <el-table-column prop="app" label="应用" min-width="160" />
            <el-table-column prop="instanceName" label="实例名称" min-width="180" />
            <el-table-column prop="region" label="地域" width="120" />
            <el-table-column prop="status" label="状态" width="120">
              <template #default="{ row }">
                <el-tag :type="row.status === '运行中' ? 'success' : 'warning'">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <el-col :span="8">
        <el-card header="操作提示">
          <el-descriptions :column="1" border>
            <el-descriptions-item label="推荐动作">
              点击“开通新实例”，在弹窗中依次选择租户、应用、规格和网络策略。
            </el-descriptions-item>
            <el-descriptions-item label="验证方式">
              成功后会弹出确认框，确认后写入实例列表和最近操作记录。
            </el-descriptions-item>
            <el-descriptions-item label="适合测试">
              AI 对深层路径导航、弹窗表单、二次确认和结果验证的完整链路。
            </el-descriptions-item>
          </el-descriptions>
        </el-card>

        <el-card header="最近操作" style="margin-top: 20px">
          <div class="log-list">
            <div v-if="logs.length === 0" class="empty-log">暂无最近操作</div>
            <div v-for="(item, idx) in logs" :key="idx" class="log-item">{{ item }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="dialogVisible" title="开通新实例" width="640px">
      <el-form :model="form" label-width="120px">
        <el-form-item label="租户">
          <el-select v-model="form.tenant" placeholder="请选择租户">
            <el-option label="华北一区" value="north-a" />
            <el-option label="华东零售事业部" value="east-retail" />
            <el-option label="南区供应链共享中心" value="south-supply" />
          </el-select>
        </el-form-item>
        <el-form-item label="应用名称">
          <el-select v-model="form.app" placeholder="请选择应用">
            <el-option label="BI 分析平台" value="bi" />
            <el-option label="统一消息中心" value="message" />
            <el-option label="工作流引擎" value="workflow" />
          </el-select>
        </el-form-item>
        <el-form-item label="实例名称">
          <el-input v-model="form.instanceName" placeholder="请输入实例名称" />
        </el-form-item>
        <el-form-item label="部署地域">
          <el-radio-group v-model="form.region">
            <el-radio value="cn-north-1">华北 1</el-radio>
            <el-radio value="cn-east-1">华东 1</el-radio>
            <el-radio value="cn-south-1">华南 1</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="实例规格">
          <el-select v-model="form.plan" placeholder="请选择规格">
            <el-option label="标准版（2C4G）" value="standard" />
            <el-option label="专业版（4C8G）" value="pro" />
            <el-option label="企业版（8C16G）" value="enterprise" />
          </el-select>
        </el-form-item>
        <el-form-item label="网络策略">
          <el-checkbox-group v-model="form.networkPolicies">
            <el-checkbox value="private-link">专线访问</el-checkbox>
            <el-checkbox value="ip-whitelist">IP 白名单</el-checkbox>
            <el-checkbox value="sso">单点登录</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmVisible = true">下一步确认</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="confirmVisible" title="确认开通" width="420px">
      <span>确认要为当前租户开通该应用实例吗？确认后会写入实例列表。</span>
      <template #footer>
        <el-button @click="confirmVisible = false">返回修改</el-button>
        <el-button type="primary" @click="submitProvision">确认开通</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

const search = ref('')
const dialogVisible = ref(false)
const confirmVisible = ref(false)
const logs = ref<string[]>([])

const instances = ref([
  { tenant: '华东零售事业部', app: '统一消息中心', instanceName: 'msg-center-prod', region: '华东 1', status: '运行中' },
  { tenant: '南区供应链共享中心', app: '工作流引擎', instanceName: 'workflow-core', region: '华南 1', status: '初始化中' },
])

const filteredInstances = computed(() => instances.value.filter(item => {
  const keyword = search.value.trim()
  if (!keyword) return true
  return item.tenant.includes(keyword) || item.instanceName.includes(keyword)
}))

const form = reactive({
  tenant: '',
  app: '',
  instanceName: '',
  region: 'cn-east-1',
  plan: '',
  networkPolicies: [] as string[],
})

function submitProvision() {
  const label = form.instanceName || '未命名实例'
  instances.value.unshift({
    tenant: form.tenant || '未选择租户',
    app: form.app || '未选择应用',
    instanceName: label,
    region: form.region,
    status: '初始化中',
  })
  logs.value.unshift(`已开通实例：${label}`)
  confirmVisible.value = false
  dialogVisible.value = false
  ElMessage.success(`实例「${label}」已提交开通`)
}
</script>

<style scoped>
.page-stack {
  display: flex;
  flex-direction: column;
}
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.log-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 120px;
}
.log-item {
  padding: 8px 10px;
  border-radius: 8px;
  background: #f4f7fb;
  font-size: 12px;
  color: #303133;
}
.empty-log {
  font-size: 12px;
  color: #909399;
}
</style>
