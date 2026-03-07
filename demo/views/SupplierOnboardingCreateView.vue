<template>
  <div class="page-stack">
    <el-row :gutter="20">
      <el-col :span="17">
        <el-card header="准入申请列表">
          <div class="toolbar">
            <el-input v-model="keyword" placeholder="搜索供应商名称 / 税号" clearable style="width: 280px" />
            <div class="toolbar-actions">
              <el-select v-model="statusFilter" placeholder="申请状态" style="width: 160px">
                <el-option label="全部" value="all" />
                <el-option label="待提交" value="draft" />
                <el-option label="审批中" value="reviewing" />
                <el-option label="已驳回" value="rejected" />
              </el-select>
              <el-button type="primary" @click="drawerVisible = true">新建准入申请</el-button>
            </div>
          </div>
          <el-table :data="filteredRecords" border stripe style="width: 100%">
            <el-table-column prop="company" label="供应商名称" min-width="220" />
            <el-table-column prop="category" label="合作品类" width="140" />
            <el-table-column prop="region" label="区域" width="120" />
            <el-table-column prop="owner" label="采购负责人" width="120" />
            <el-table-column label="状态" width="120">
              <template #default="{ row }">
                <el-tag :type="row.status === '审批中' ? 'warning' : row.status === '已驳回' ? 'danger' : 'info'">
                  {{ row.status }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <el-col :span="7">
        <el-card header="测试说明">
          <el-steps direction="vertical" :active="3">
            <el-step title="进入采购中心" description="定位“供应商管理 / 准入申请 / 新建申请”页面" />
            <el-step title="打开抽屉" description="点击右上角“新建准入申请”按钮" />
            <el-step title="填写并提交" description="完成供应商信息、财务信息、合规信息录入" />
          </el-steps>
        </el-card>

        <el-card header="最近操作" style="margin-top: 20px">
          <div class="log-list">
            <div v-if="logs.length === 0" class="empty-log">暂无操作记录</div>
            <div v-for="(item, idx) in logs" :key="idx" class="log-item">{{ item }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-drawer v-model="drawerVisible" title="新建准入申请" size="720px">
      <el-form :model="form" label-width="120px">
        <el-tabs v-model="activeTab">
          <el-tab-pane label="供应商信息" name="base">
            <el-form-item label="供应商名称">
              <el-input v-model="form.companyName" placeholder="请输入供应商名称" />
            </el-form-item>
            <el-form-item label="供应商简称">
              <el-input v-model="form.shortName" placeholder="请输入简称" />
            </el-form-item>
            <el-form-item label="统一社会信用代码">
              <el-input v-model="form.taxNo" placeholder="请输入统一社会信用代码" />
            </el-form-item>
            <el-form-item label="合作类型">
              <el-select v-model="form.cooperationType" placeholder="请选择合作类型">
                <el-option label="物流运输" value="logistics" />
                <el-option label="仓储服务" value="warehouse" />
                <el-option label="原材料采购" value="material" />
              </el-select>
            </el-form-item>
            <el-form-item label="合作区域">
              <el-cascader v-model="form.region" :options="regionOptions" placeholder="请选择区域" />
            </el-form-item>
            <el-form-item label="采购品类">
              <el-select v-model="form.categories" multiple collapse-tags placeholder="请选择品类">
                <el-option label="冷链物流" value="cold-chain" />
                <el-option label="常温运输" value="normal-logistics" />
                <el-option label="城市配送" value="city-delivery" />
                <el-option label="包装材料" value="package-material" />
              </el-select>
            </el-form-item>
          </el-tab-pane>

          <el-tab-pane label="财务信息" name="finance">
            <el-form-item label="结算方式">
              <el-radio-group v-model="form.settlementMode">
                <el-radio value="monthly">月结</el-radio>
                <el-radio value="biweekly">半月结</el-radio>
                <el-radio value="cash">现结</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="开户银行">
              <el-input v-model="form.bankName" placeholder="请输入开户银行" />
            </el-form-item>
            <el-form-item label="银行账号">
              <el-input v-model="form.bankAccount" placeholder="请输入银行账号" />
            </el-form-item>
            <el-form-item label="税率">
              <el-select v-model="form.taxRate" placeholder="请选择税率">
                <el-option label="3%" value="3" />
                <el-option label="6%" value="6" />
                <el-option label="9%" value="9" />
                <el-option label="13%" value="13" />
              </el-select>
            </el-form-item>
          </el-tab-pane>

          <el-tab-pane label="合规信息" name="compliance">
            <el-form-item label="资质检查">
              <el-checkbox-group v-model="form.complianceItems">
                <el-checkbox value="license">营业执照</el-checkbox>
                <el-checkbox value="tax">税务登记</el-checkbox>
                <el-checkbox value="insurance">运输保险</el-checkbox>
                <el-checkbox value="security">安全承诺书</el-checkbox>
              </el-checkbox-group>
            </el-form-item>
            <el-form-item label="备注说明">
              <el-input v-model="form.remark" type="textarea" :rows="4" placeholder="请输入补充说明" />
            </el-form-item>
          </el-tab-pane>
        </el-tabs>
      </el-form>

      <template #footer>
        <div class="drawer-footer">
          <el-button @click="saveDraft">保存草稿</el-button>
          <el-button type="primary" @click="submitApply">提交申请</el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

const keyword = ref('')
const statusFilter = ref('all')
const drawerVisible = ref(false)
const activeTab = ref('base')
const logs = ref<string[]>([])

const records = ref([
  { company: '华东快运有限公司', category: '物流运输', region: '华东', owner: '林晓', status: '审批中' },
  { company: '安硕仓储服务', category: '仓储服务', region: '华北', owner: '何川', status: '待提交' },
  { company: '瑞海包装材料', category: '包装材料', region: '华南', owner: '郑敏', status: '已驳回' },
])

const filteredRecords = computed(() => records.value.filter(item => {
  const hitKeyword = !keyword.value || item.company.includes(keyword.value)
  const hitStatus = statusFilter.value === 'all' || item.status === ({ draft: '待提交', reviewing: '审批中', rejected: '已驳回' } as Record<string, string>)[statusFilter.value]
  return hitKeyword && hitStatus
}))

const form = reactive({
  companyName: '',
  shortName: '',
  taxNo: '',
  cooperationType: '',
  region: [] as string[],
  categories: [] as string[],
  settlementMode: 'monthly',
  bankName: '',
  bankAccount: '',
  taxRate: '',
  complianceItems: [] as string[],
  remark: '',
})

const regionOptions = [
  {
    value: 'east',
    label: '华东',
    children: [
      { value: 'shanghai', label: '上海' },
      { value: 'hangzhou', label: '杭州' },
      { value: 'nanjing', label: '南京' },
    ],
  },
  {
    value: 'north',
    label: '华北',
    children: [
      { value: 'beijing', label: '北京' },
      { value: 'tianjin', label: '天津' },
      { value: 'jinan', label: '济南' },
    ],
  },
]

function saveDraft() {
  const label = form.companyName || '未命名供应商'
  logs.value.unshift(`草稿已保存：${label}`)
  ElMessage.success('准入申请草稿已保存')
}

function submitApply() {
  const label = form.companyName || '未命名供应商'
  logs.value.unshift(`申请已提交：${label}`)
  records.value.unshift({ company: label, category: '待补充', region: '待补充', owner: '当前用户', status: '审批中' })
  drawerVisible.value = false
  ElMessage.success(`供应商准入申请「${label}」已提交`)
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
.toolbar-actions {
  display: flex;
  gap: 12px;
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
.drawer-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
